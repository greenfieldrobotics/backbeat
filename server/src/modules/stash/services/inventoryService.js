// Stash inventory services — all SQL for `inventory`, `fifo_layers` and
// `inventory_transactions` lives here, together with the FIFO costing rules.
//
// Every function takes a `db` as its first argument: the pool for reads, or a pg client
// already inside a BEGIN for anything that writes. The write functions do NOT manage the
// transaction themselves — the caller owns BEGIN/COMMIT/ROLLBACK (see `withTransaction`).
// That is what lets cross-module workflows compose them; see `workflows/commissionAsset.js`.
//
// On failure they throw an Error with a `.status` property for the HTTP layer to use.

import { executeSqlStrict, executeSqlWrite } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

/** Oldest-first FIFO layers with stock left, for one part at one location. */
async function openFifoLayers(client, part_id, location_id) {
  return executeSqlStrict(client, `
    SELECT * FROM fifo_layers
    WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0
    ORDER BY created_at ASC, id ASC
  `, [part_id, location_id]);
}

/** Current stock levels across every part and location. */
export async function listInventory(db) {
  return executeSqlStrict(db, `
    SELECT
      i.id,
      i.part_id,
      p.part_number,
      p.description as part_description,
      p.classification,
      i.location_id,
      l.name as location_name,
      i.quantity_on_hand
    FROM inventory i
    JOIN parts p ON i.part_id = p.id
    JOIN locations l ON i.location_id = l.id
    ORDER BY p.part_number, l.name
  `);
}

/** FIFO layers, optionally filtered; depleted layers are hidden unless asked for. */
export async function listFifoLayers(db, { part_id, location_id, include_depleted } = {}) {
  let sql = `
    SELECT
      fl.id,
      fl.part_id,
      p.part_number,
      p.description as part_description,
      fl.location_id,
      l.name as location_name,
      fl.source_type,
      fl.source_ref,
      fl.original_qty,
      fl.remaining_qty,
      fl.unit_cost,
      fl.created_at
    FROM fifo_layers fl
    JOIN parts p ON fl.part_id = p.id
    JOIN locations l ON fl.location_id = l.id
  `;

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (!include_depleted) {
    conditions.push('fl.remaining_qty > 0');
  }
  if (part_id) {
    conditions.push(`fl.part_id = $${paramIndex++}`);
    params.push(part_id);
  }
  if (location_id) {
    conditions.push(`fl.location_id = $${paramIndex++}`);
    params.push(location_id);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY fl.part_id, fl.location_id, fl.created_at ASC';

  return executeSqlStrict(db, sql, params);
}

/**
 * Issue parts out of inventory using FIFO cost consumption.
 * Reused by POST /api/stash/inventory/issue and by the commission-asset workflow.
 */
export async function issueParts(client, {
  part_id,
  location_id,
  quantity,
  reason = null,
  target_ref = null,
  reference_type = 'MANUAL',
  reference_id = null,
}) {
  if (!part_id || !location_id || !quantity || quantity <= 0) {
    throw httpError('part_id, location_id, and positive quantity are required', 400);
  }

  const partRows = await executeSqlStrict(client, 'SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) throw httpError('Part not found', 404);
  const part = partRows[0];

  const locRows = await executeSqlStrict(client, 'SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) throw httpError('Location not found', 404);
  const location = locRows[0];

  const invRows = await executeSqlStrict(
    client,
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    throw httpError(
      `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`,
      400
    );
  }

  // Consume FIFO layers oldest first
  const layers = await openFifoLayers(client, part_id, location_id);

  let remainingToIssue = quantity;
  let totalCost = 0;
  const layersConsumed = [];

  for (const layer of layers) {
    if (remainingToIssue <= 0) break;

    const consumeQty = Math.min(remainingToIssue, layer.remaining_qty);
    const consumeCost = consumeQty * layer.unit_cost;

    await executeSqlWrite(
      client,
      'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
      [consumeQty, layer.id]
    );

    layersConsumed.push({
      layer_id: layer.id,
      quantity_consumed: consumeQty,
      unit_cost: layer.unit_cost,
      cost: consumeCost,
      source_ref: layer.source_ref,
    });

    totalCost += consumeCost;
    remainingToIssue -= consumeQty;
  }

  // Update inventory
  await executeSqlWrite(
    client,
    'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
    [quantity, part_id, location_id]
  );

  // Audit trail
  const avgCost = totalCost / quantity;
  await executeSqlWrite(client, `
    INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reference_id, target_ref, reason, fifo_layers_consumed)
    VALUES ('ISSUE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [part_id, location_id, -quantity, avgCost, -totalCost, reference_type, reference_id, target_ref, reason, JSON.stringify(layersConsumed)]);

  return {
    part_number: part.part_number,
    location: location.name,
    quantity_issued: quantity,
    total_cost: totalCost,
    average_unit_cost: avgCost,
    target_ref,
    fifo_layers_consumed: layersConsumed,
  };
}

/**
 * Move inventory between locations (Story 3.1).
 * FIFO layers are split rather than re-costed: the destination layer keeps the source
 * layer's unit cost, source reference and original receipt date, so moving stock never
 * changes what it is worth.
 */
export async function moveInventory(client, { part_id, from_location_id, to_location_id, quantity }) {
  if (!part_id || !from_location_id || !to_location_id || !quantity || quantity <= 0) {
    throw httpError('part_id, from_location_id, to_location_id, and positive quantity are required', 400);
  }
  if (from_location_id === to_location_id) {
    throw httpError('Source and destination locations must be different', 400);
  }

  const partRows = await executeSqlStrict(client, 'SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) throw httpError('Part not found', 404);
  const part = partRows[0];

  const fromLocRows = await executeSqlStrict(client, 'SELECT * FROM locations WHERE id = $1', [from_location_id]);
  if (fromLocRows.length === 0) throw httpError('Source location not found', 404);
  const fromLoc = fromLocRows[0];

  const toLocRows = await executeSqlStrict(client, 'SELECT * FROM locations WHERE id = $1', [to_location_id]);
  if (toLocRows.length === 0) throw httpError('Destination location not found', 404);
  const toLoc = toLocRows[0];

  const invRows = await executeSqlStrict(
    client,
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, from_location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    throw httpError(
      `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`,
      400
    );
  }

  // Take FIFO layers oldest first from the source location
  const layers = await openFifoLayers(client, part_id, from_location_id);

  let remainingToMove = quantity;
  let totalCost = 0;
  const layersMoved = [];

  for (const layer of layers) {
    if (remainingToMove <= 0) break;

    const moveQty = Math.min(remainingToMove, layer.remaining_qty);
    const moveCost = moveQty * layer.unit_cost;

    // Reduce source layer
    await executeSqlWrite(
      client,
      'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
      [moveQty, layer.id]
    );

    // Create new layer at destination (preserving original cost and source)
    await executeSqlWrite(client, `
      INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [part_id, to_location_id, layer.source_type, layer.source_ref, moveQty, moveQty, layer.unit_cost, layer.created_at]);

    layersMoved.push({
      source_layer_id: layer.id,
      quantity_moved: moveQty,
      unit_cost: layer.unit_cost,
      cost: moveCost,
    });

    totalCost += moveCost;
    remainingToMove -= moveQty;
  }

  // Update source inventory
  await executeSqlWrite(
    client,
    'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
    [quantity, part_id, from_location_id]
  );

  // Upsert destination inventory
  await executeSqlWrite(client, `
    INSERT INTO inventory (part_id, location_id, quantity_on_hand)
    VALUES ($1, $2, $3)
    ON CONFLICT(part_id, location_id) DO UPDATE SET quantity_on_hand = inventory.quantity_on_hand + $4
  `, [part_id, to_location_id, quantity, quantity]);

  // Audit trail
  const avgCost = totalCost / quantity;
  await executeSqlWrite(client, `
    INSERT INTO inventory_transactions (transaction_type, part_id, location_id, to_location_id, quantity, unit_cost, total_cost, reference_type, fifo_layers_consumed)
    VALUES ('MOVE', $1, $2, $3, $4, $5, $6, 'MANUAL', $7)
  `, [part_id, from_location_id, to_location_id, quantity, avgCost, totalCost, JSON.stringify(layersMoved)]);

  return {
    part_number: part.part_number,
    from_location: fromLoc.name,
    to_location: toLoc.name,
    quantity_moved: quantity,
    total_cost: totalCost,
    fifo_layers_moved: layersMoved,
  };
}

/** Dispose of inventory — same FIFO consumption as an issue, but nothing is issued to (Story 5.2). */
export async function disposeInventory(client, { part_id, location_id, quantity, reason }) {
  if (!part_id || !location_id || !quantity || quantity <= 0) {
    throw httpError('part_id, location_id, and positive quantity are required', 400);
  }
  if (!reason) {
    throw httpError('reason is required for disposal (e.g., damaged, obsolete, expired)', 400);
  }

  const partRows = await executeSqlStrict(client, 'SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) throw httpError('Part not found', 404);
  const part = partRows[0];

  const locRows = await executeSqlStrict(client, 'SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) throw httpError('Location not found', 404);
  const location = locRows[0];

  const invRows = await executeSqlStrict(
    client,
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    throw httpError(
      `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`,
      400
    );
  }

  // Consume FIFO layers oldest first
  const layers = await openFifoLayers(client, part_id, location_id);

  let remainingToDispose = quantity;
  let totalCost = 0;
  const layersConsumed = [];

  for (const layer of layers) {
    if (remainingToDispose <= 0) break;

    const consumeQty = Math.min(remainingToDispose, layer.remaining_qty);
    const consumeCost = consumeQty * layer.unit_cost;

    await executeSqlWrite(
      client,
      'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
      [consumeQty, layer.id]
    );

    layersConsumed.push({
      layer_id: layer.id,
      quantity_consumed: consumeQty,
      unit_cost: layer.unit_cost,
      cost: consumeCost,
    });

    totalCost += consumeCost;
    remainingToDispose -= consumeQty;
  }

  // Update inventory
  await executeSqlWrite(
    client,
    'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
    [quantity, part_id, location_id]
  );

  // Audit trail
  const avgCost = totalCost / quantity;
  await executeSqlWrite(client, `
    INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reason, fifo_layers_consumed)
    VALUES ('DISPOSE', $1, $2, $3, $4, $5, 'MANUAL', $6, $7)
  `, [part_id, location_id, -quantity, avgCost, -totalCost, reason, JSON.stringify(layersConsumed)]);

  return {
    part_number: part.part_number,
    location: location.name,
    quantity_disposed: quantity,
    total_cost: totalCost,
    reason,
    fifo_layers_consumed: layersConsumed,
  };
}

/** Return parts to inventory — opens a fresh FIFO layer at the stated cost (Story 5.4). */
export async function returnParts(client, { part_id, location_id, quantity, unit_cost, reason, reference }) {
  if (!part_id || !location_id || !quantity || quantity <= 0) {
    throw httpError('part_id, location_id, and positive quantity are required', 400);
  }
  if (unit_cost === undefined || unit_cost === null || unit_cost < 0) {
    throw httpError('unit_cost is required and must be >= 0', 400);
  }

  const partRows = await executeSqlStrict(client, 'SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) throw httpError('Part not found', 404);
  const part = partRows[0];

  const locRows = await executeSqlStrict(client, 'SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) throw httpError('Location not found', 404);
  const location = locRows[0];

  // Create new FIFO layer for the return
  const [fifoLayer] = await executeSqlStrict(client, `
    INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost)
    VALUES ($1, $2, 'RETURN', $3, $4, $5, $6)
    RETURNING *
  `, [part_id, location_id, reference || null, quantity, quantity, unit_cost]);

  // Upsert inventory
  await executeSqlWrite(client, `
    INSERT INTO inventory (part_id, location_id, quantity_on_hand)
    VALUES ($1, $2, $3)
    ON CONFLICT(part_id, location_id) DO UPDATE SET quantity_on_hand = inventory.quantity_on_hand + $4
  `, [part_id, location_id, quantity, quantity]);

  // Audit trail
  const totalCost = quantity * unit_cost;
  await executeSqlWrite(client, `
    INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, target_ref, reason)
    VALUES ('RETURN', $1, $2, $3, $4, $5, 'MANUAL', $6, $7)
  `, [part_id, location_id, quantity, unit_cost, totalCost, reference || null, reason || null]);

  return {
    part_number: part.part_number,
    location: location.name,
    quantity_returned: quantity,
    unit_cost: Number(unit_cost),
    total_cost: totalCost,
    reason: reason || null,
    fifo_layer_created: {
      id: fifoLayer.id,
      source_type: fifoLayer.source_type,
      original_qty: fifoLayer.original_qty,
      remaining_qty: fifoLayer.remaining_qty,
      unit_cost: Number(fifoLayer.unit_cost),
    },
  };
}

/** Most recent FIFO unit cost for a part, at a location and then anywhere. */
async function latestUnitCost(client, part_id, location_id) {
  const atLocation = await executeSqlStrict(client, `
    SELECT unit_cost FROM fifo_layers
    WHERE part_id = $1 AND location_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [part_id, location_id]);
  if (atLocation.length > 0) return Number(atLocation[0].unit_cost);

  const anywhere = await executeSqlStrict(client, `
    SELECT unit_cost FROM fifo_layers
    WHERE part_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [part_id]);
  if (anywhere.length > 0) return Number(anywhere[0].unit_cost);

  return null;
}

/**
 * Set inventory to a counted quantity (Story 5.5).
 * A shortage consumes FIFO layers oldest-first; an overage opens a new layer, costed at
 * the caller's `unit_cost` or, failing that, the part's most recent known cost.
 */
export async function adjustInventory(client, { part_id, location_id, new_quantity, unit_cost, reason }) {
  if (!part_id || !location_id || new_quantity === undefined || new_quantity === null || new_quantity < 0) {
    throw httpError('part_id, location_id, and new_quantity (>= 0) are required', 400);
  }
  if (!reason) {
    throw httpError('reason is required for inventory adjustments', 400);
  }

  const partRows = await executeSqlStrict(client, 'SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) throw httpError('Part not found', 404);
  const part = partRows[0];

  const locRows = await executeSqlStrict(client, 'SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) throw httpError('Location not found', 404);
  const location = locRows[0];

  // Get current quantity
  const invRows = await executeSqlStrict(
    client,
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, location_id]
  );
  const currentQty = invRows.length > 0 ? invRows[0].quantity_on_hand : 0;
  const delta = new_quantity - currentQty;

  // No change needed
  if (delta === 0) {
    return {
      part_number: part.part_number,
      location: location.name,
      before_quantity: currentQty,
      after_quantity: new_quantity,
      delta: 0,
      message: 'No adjustment needed',
    };
  }

  let totalCost = 0;
  let adjustUnitCost = null;
  let fifoLayersConsumed = null;
  let fifoLayerCreated = null;

  if (delta < 0) {
    // Shortage — consume FIFO layers oldest-first
    const absDelta = Math.abs(delta);

    const invCheck = await executeSqlStrict(
      client,
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part_id, location_id]
    );
    if (!invCheck[0] || invCheck[0].quantity_on_hand < absDelta) {
      throw new Error(`Insufficient inventory. Available: ${invCheck[0] ? invCheck[0].quantity_on_hand : 0}, Adjustment requires: ${absDelta}`);
    }

    const layers = await openFifoLayers(client, part_id, location_id);

    let remainingToConsume = absDelta;
    const layersConsumed = [];

    for (const layer of layers) {
      if (remainingToConsume <= 0) break;

      const consumeQty = Math.min(remainingToConsume, layer.remaining_qty);
      const consumeCost = consumeQty * layer.unit_cost;

      await executeSqlWrite(
        client,
        'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
        [consumeQty, layer.id]
      );

      layersConsumed.push({
        layer_id: layer.id,
        quantity_consumed: consumeQty,
        unit_cost: Number(layer.unit_cost),
        cost: consumeCost,
      });

      totalCost += consumeCost;
      remainingToConsume -= consumeQty;
    }

    // Update inventory
    await executeSqlWrite(
      client,
      'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
      [absDelta, part_id, location_id]
    );

    adjustUnitCost = totalCost / absDelta;
    fifoLayersConsumed = layersConsumed;

    // Audit trail
    await executeSqlWrite(client, `
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reason, fifo_layers_consumed)
      VALUES ('ADJUSTMENT', $1, $2, $3, $4, $5, 'MANUAL', $6, $7)
    `, [part_id, location_id, delta, adjustUnitCost, -totalCost, reason, JSON.stringify(layersConsumed)]);

  } else {
    // Overage — create new FIFO layer
    // Determine cost: use provided unit_cost, else the most recent layer's unit_cost
    let costToUse = unit_cost;
    if (costToUse === undefined || costToUse === null) {
      costToUse = await latestUnitCost(client, part_id, location_id);
      if (costToUse === null) {
        throw new Error('unit_cost is required when no existing FIFO layers exist to derive cost from');
      }
    }

    totalCost = delta * costToUse;
    adjustUnitCost = costToUse;

    // Create FIFO layer
    const [fifoLayer] = await executeSqlStrict(client, `
      INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost)
      VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5, $6)
      RETURNING *
    `, [part_id, location_id, reason, delta, delta, costToUse]);

    fifoLayerCreated = {
      id: fifoLayer.id,
      source_type: fifoLayer.source_type,
      original_qty: fifoLayer.original_qty,
      remaining_qty: fifoLayer.remaining_qty,
      unit_cost: Number(fifoLayer.unit_cost),
    };

    // Upsert inventory
    await executeSqlWrite(client, `
      INSERT INTO inventory (part_id, location_id, quantity_on_hand)
      VALUES ($1, $2, $3)
      ON CONFLICT(part_id, location_id) DO UPDATE SET quantity_on_hand = inventory.quantity_on_hand + $4
    `, [part_id, location_id, delta, delta]);

    // Audit trail
    await executeSqlWrite(client, `
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reason)
      VALUES ('ADJUSTMENT', $1, $2, $3, $4, $5, 'MANUAL', $6)
    `, [part_id, location_id, delta, costToUse, totalCost, reason]);
  }

  const result = {
    part_number: part.part_number,
    location: location.name,
    before_quantity: currentQty,
    after_quantity: new_quantity,
    delta,
    unit_cost: adjustUnitCost,
    total_cost: totalCost,
    reason,
  };
  if (fifoLayersConsumed) result.fifo_layers_consumed = fifoLayersConsumed;
  if (fifoLayerCreated) result.fifo_layer_created = fifoLayerCreated;

  return result;
}

/** Audit trail, newest first. */
export async function listTransactions(db, { part_id, location_id, limit = 100 } = {}) {
  let sql = `
    SELECT
      t.*,
      p.part_number,
      p.description as part_description,
      l.name as location_name,
      tl.name as to_location_name
    FROM inventory_transactions t
    JOIN parts p ON t.part_id = p.id
    JOIN locations l ON t.location_id = l.id
    LEFT JOIN locations tl ON t.to_location_id = tl.id
  `;

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (part_id) {
    conditions.push(`t.part_id = $${paramIndex++}`);
    params.push(part_id);
  }
  if (location_id) {
    conditions.push(`t.location_id = $${paramIndex++}`);
    params.push(location_id);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ` ORDER BY t.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  return executeSqlStrict(db, sql, params);
}

/** FIFO valuation: every open layer, a per-part/location summary, and the grand total. */
export async function getValuation(db) {
  const layers = await executeSqlStrict(db, `
    SELECT
      p.part_number,
      p.description as part_description,
      p.classification,
      l.name as location_name,
      fl.source_ref,
      fl.original_qty,
      fl.remaining_qty,
      fl.unit_cost,
      (fl.remaining_qty * fl.unit_cost) as total_value,
      fl.created_at as receipt_date
    FROM fifo_layers fl
    JOIN parts p ON fl.part_id = p.id
    JOIN locations l ON fl.location_id = l.id
    WHERE fl.remaining_qty > 0
    ORDER BY p.part_number, l.name, fl.created_at ASC
  `);

  // Summary by part and location
  const summary = await executeSqlStrict(db, `
    SELECT
      p.part_number,
      p.description as part_description,
      l.name as location_name,
      SUM(fl.remaining_qty) as total_qty,
      SUM(fl.remaining_qty * fl.unit_cost) as total_value
    FROM fifo_layers fl
    JOIN parts p ON fl.part_id = p.id
    JOIN locations l ON fl.location_id = l.id
    WHERE fl.remaining_qty > 0
    GROUP BY fl.part_id, fl.location_id, p.part_number, p.description, l.name
    ORDER BY p.part_number, l.name
  `);

  const grandTotal = summary.reduce((sum, row) => sum + Number(row.total_value), 0);

  return { layers, summary, grand_total: grandTotal };
}
