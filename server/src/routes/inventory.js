import { Router } from 'express';
import { query, getClient } from '../db/connection.js';

const router = Router();

// GET /api/inventory - Current stock levels
router.get('/', async (req, res) => {
  const { rows } = await query(`
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
  res.json(rows);
});

// GET /api/inventory/fifo-layers - All FIFO layers with remaining qty > 0
router.get('/fifo-layers', async (req, res) => {
  const { part_id, location_id, include_depleted } = req.query;

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

  const { rows } = await query(sql, params);
  res.json(rows);
});

// POST /api/inventory/move - Move inventory between locations (Story 3.1)
router.post('/move', async (req, res) => {
  const { part_id, from_location_id, to_location_id, quantity } = req.body;

  if (!part_id || !from_location_id || !to_location_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'part_id, from_location_id, to_location_id, and positive quantity are required' });
  }
  if (from_location_id === to_location_id) {
    return res.status(400).json({ error: 'Source and destination locations must be different' });
  }

  const { rows: partRows } = await query('SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) return res.status(404).json({ error: 'Part not found' });
  const part = partRows[0];

  const { rows: fromLocRows } = await query('SELECT * FROM locations WHERE id = $1', [from_location_id]);
  if (fromLocRows.length === 0) return res.status(404).json({ error: 'Source location not found' });
  const fromLoc = fromLocRows[0];

  const { rows: toLocRows } = await query('SELECT * FROM locations WHERE id = $1', [to_location_id]);
  if (toLocRows.length === 0) return res.status(404).json({ error: 'Destination location not found' });
  const toLoc = toLocRows[0];

  const { rows: invRows } = await query(
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, from_location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    return res.status(400).json({
      error: `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Get FIFO layers oldest first from source location
    const { rows: layers } = await client.query(`
      SELECT * FROM fifo_layers
      WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0
      ORDER BY created_at ASC, id ASC
    `, [part_id, from_location_id]);

    let remainingToMove = quantity;
    let totalCost = 0;
    const layersMoved = [];

    for (const layer of layers) {
      if (remainingToMove <= 0) break;

      const moveQty = Math.min(remainingToMove, layer.remaining_qty);
      const moveCost = moveQty * layer.unit_cost;

      // Reduce source layer
      await client.query(
        'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
        [moveQty, layer.id]
      );

      // Create new layer at destination (preserving original cost and source)
      await client.query(`
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
    await client.query(
      'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
      [quantity, part_id, from_location_id]
    );

    // Upsert destination inventory
    await client.query(`
      INSERT INTO inventory (part_id, location_id, quantity_on_hand)
      VALUES ($1, $2, $3)
      ON CONFLICT(part_id, location_id) DO UPDATE SET quantity_on_hand = inventory.quantity_on_hand + $4
    `, [part_id, to_location_id, quantity, quantity]);

    // Audit trail
    const avgCost = totalCost / quantity;
    await client.query(`
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, to_location_id, quantity, unit_cost, total_cost, reference_type, fifo_layers_consumed)
      VALUES ('MOVE', $1, $2, $3, $4, $5, $6, 'MANUAL', $7)
    `, [part_id, from_location_id, to_location_id, quantity, avgCost, totalCost, JSON.stringify(layersMoved)]);

    await client.query('COMMIT');

    res.json({
      part_number: part.part_number,
      from_location: fromLoc.name,
      to_location: toLoc.name,
      quantity_moved: quantity,
      total_cost: totalCost,
      fifo_layers_moved: layersMoved,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/inventory/dispose - Dispose of inventory (Story 5.2)
router.post('/dispose', async (req, res) => {
  const { part_id, location_id, quantity, reason } = req.body;

  if (!part_id || !location_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'part_id, location_id, and positive quantity are required' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'reason is required for disposal (e.g., damaged, obsolete, expired)' });
  }

  const { rows: partRows } = await query('SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) return res.status(404).json({ error: 'Part not found' });
  const part = partRows[0];

  const { rows: locRows } = await query('SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) return res.status(404).json({ error: 'Location not found' });
  const location = locRows[0];

  const { rows: invRows } = await query(
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    return res.status(400).json({
      error: `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Consume FIFO layers oldest first
    const { rows: layers } = await client.query(`
      SELECT * FROM fifo_layers
      WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0
      ORDER BY created_at ASC, id ASC
    `, [part_id, location_id]);

    let remainingToDispose = quantity;
    let totalCost = 0;
    const layersConsumed = [];

    for (const layer of layers) {
      if (remainingToDispose <= 0) break;

      const consumeQty = Math.min(remainingToDispose, layer.remaining_qty);
      const consumeCost = consumeQty * layer.unit_cost;

      await client.query(
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
    await client.query(
      'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
      [quantity, part_id, location_id]
    );

    // Audit trail
    const avgCost = totalCost / quantity;
    await client.query(`
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reason, fifo_layers_consumed)
      VALUES ('DISPOSE', $1, $2, $3, $4, $5, 'MANUAL', $6, $7)
    `, [part_id, location_id, -quantity, avgCost, -totalCost, reason, JSON.stringify(layersConsumed)]);

    await client.query('COMMIT');

    res.json({
      part_number: part.part_number,
      location: location.name,
      quantity_disposed: quantity,
      total_cost: totalCost,
      reason,
      fifo_layers_consumed: layersConsumed,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/inventory/issue - Issue parts (FIFO consumption) (Story 5.1)
router.post('/issue', async (req, res) => {
  const { part_id, location_id, quantity, reason, target_ref } = req.body;

  if (!part_id || !location_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'part_id, location_id, and positive quantity are required' });
  }

  const { rows: partRows } = await query('SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) return res.status(404).json({ error: 'Part not found' });
  const part = partRows[0];

  const { rows: locRows } = await query('SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) return res.status(404).json({ error: 'Location not found' });
  const location = locRows[0];

  const { rows: invRows } = await query(
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    return res.status(400).json({
      error: `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Get FIFO layers oldest first
    const { rows: layers } = await client.query(`
      SELECT * FROM fifo_layers
      WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0
      ORDER BY created_at ASC, id ASC
    `, [part_id, location_id]);

    let remainingToIssue = quantity;
    let totalCost = 0;
    const layersConsumed = [];

    for (const layer of layers) {
      if (remainingToIssue <= 0) break;

      const consumeQty = Math.min(remainingToIssue, layer.remaining_qty);
      const consumeCost = consumeQty * layer.unit_cost;

      await client.query(
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
    await client.query(
      'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
      [quantity, part_id, location_id]
    );

    // Audit trail
    const avgCost = totalCost / quantity;
    await client.query(`
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, target_ref, reason, fifo_layers_consumed)
      VALUES ('ISSUE', $1, $2, $3, $4, $5, 'MANUAL', $6, $7, $8)
    `, [part_id, location_id, -quantity, avgCost, -totalCost, target_ref || null, reason || null, JSON.stringify(layersConsumed)]);

    await client.query('COMMIT');

    res.json({
      part_number: part.part_number,
      location: location.name,
      quantity_issued: quantity,
      total_cost: totalCost,
      average_unit_cost: avgCost,
      target_ref: target_ref || null,
      fifo_layers_consumed: layersConsumed,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/inventory/transactions - Audit trail
router.get('/transactions', async (req, res) => {
  const { part_id, location_id, limit: queryLimit } = req.query;
  const limitVal = parseInt(queryLimit) || 100;

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
  params.push(limitVal);

  const { rows } = await query(sql, params);
  res.json(rows);
});

// GET /api/inventory/valuation - FIFO valuation report
router.get('/valuation', async (req, res) => {
  const { format } = req.query;

  const { rows: layers } = await query(`
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
  const { rows: summary } = await query(`
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

  const grandTotal = summary.reduce((sum, row) => sum + row.total_value, 0);

  if (format === 'csv') {
    const csvLines = [
      'Part Number,Description,Location,Source,Original Qty,Remaining Qty,Unit Cost,Total Value,Receipt Date',
    ];
    for (const row of layers) {
      csvLines.push([
        row.part_number,
        `"${row.part_description}"`,
        `"${row.location_name}"`,
        row.source_ref,
        row.original_qty,
        row.remaining_qty,
        row.unit_cost.toFixed(2),
        row.total_value.toFixed(2),
        row.receipt_date,
      ].join(','));
    }
    csvLines.push('');
    csvLines.push(`,,,,,,Grand Total,"${grandTotal.toFixed(2)}",`);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=fifo_valuation_report.csv');
    return res.send(csvLines.join('\n'));
  }

  res.json({ layers, summary, grand_total: grandTotal });
});

export default router;
