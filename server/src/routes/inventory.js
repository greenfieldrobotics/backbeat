import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/inventory - Current stock levels
router.get('/', (req, res) => {
  const db = getDb();
  const inventory = db.prepare(`
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
  `).all();
  res.json(inventory);
});

// GET /api/inventory/fifo-layers - All FIFO layers with remaining qty > 0
router.get('/fifo-layers', (req, res) => {
  const db = getDb();
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

  if (!include_depleted) {
    conditions.push('fl.remaining_qty > 0');
  }
  if (part_id) {
    conditions.push('fl.part_id = ?');
    params.push(part_id);
  }
  if (location_id) {
    conditions.push('fl.location_id = ?');
    params.push(location_id);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY fl.part_id, fl.location_id, fl.created_at ASC';

  const layers = db.prepare(sql).all(...params);
  res.json(layers);
});

// POST /api/inventory/move - Move inventory between locations (Story 3.1)
router.post('/move', (req, res) => {
  const db = getDb();
  const { part_id, from_location_id, to_location_id, quantity } = req.body;

  if (!part_id || !from_location_id || !to_location_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'part_id, from_location_id, to_location_id, and positive quantity are required' });
  }
  if (from_location_id === to_location_id) {
    return res.status(400).json({ error: 'Source and destination locations must be different' });
  }

  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
  if (!part) return res.status(404).json({ error: 'Part not found' });

  const fromLoc = db.prepare('SELECT * FROM locations WHERE id = ?').get(from_location_id);
  if (!fromLoc) return res.status(404).json({ error: 'Source location not found' });

  const toLoc = db.prepare('SELECT * FROM locations WHERE id = ?').get(to_location_id);
  if (!toLoc) return res.status(404).json({ error: 'Destination location not found' });

  const inv = db.prepare('SELECT * FROM inventory WHERE part_id = ? AND location_id = ?').get(part_id, from_location_id);
  if (!inv || inv.quantity_on_hand < quantity) {
    return res.status(400).json({
      error: `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`
    });
  }

  const move = db.transaction(() => {
    // Get FIFO layers oldest first from source location
    const layers = db.prepare(`
      SELECT * FROM fifo_layers
      WHERE part_id = ? AND location_id = ? AND remaining_qty > 0
      ORDER BY created_at ASC, id ASC
    `).all(part_id, from_location_id);

    let remainingToMove = quantity;
    let totalCost = 0;
    const layersMoved = [];

    for (const layer of layers) {
      if (remainingToMove <= 0) break;

      const moveQty = Math.min(remainingToMove, layer.remaining_qty);
      const moveCost = moveQty * layer.unit_cost;

      // Reduce source layer
      db.prepare('UPDATE fifo_layers SET remaining_qty = remaining_qty - ? WHERE id = ?')
        .run(moveQty, layer.id);

      // Create new layer at destination (preserving original cost and source)
      db.prepare(`
        INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(part_id, to_location_id, layer.source_type, layer.source_ref, moveQty, moveQty, layer.unit_cost, layer.created_at);

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
    db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand - ? WHERE part_id = ? AND location_id = ?')
      .run(quantity, part_id, from_location_id);

    // Upsert destination inventory
    const destInv = db.prepare('SELECT * FROM inventory WHERE part_id = ? AND location_id = ?').get(part_id, to_location_id);
    if (destInv) {
      db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand + ? WHERE part_id = ? AND location_id = ?')
        .run(quantity, part_id, to_location_id);
    } else {
      db.prepare('INSERT INTO inventory (part_id, location_id, quantity_on_hand) VALUES (?, ?, ?)')
        .run(part_id, to_location_id, quantity);
    }

    // Audit trail
    const avgCost = totalCost / quantity;
    db.prepare(`
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, to_location_id, quantity, unit_cost, total_cost, reference_type, fifo_layers_consumed)
      VALUES ('MOVE', ?, ?, ?, ?, ?, ?, 'MANUAL', ?)
    `).run(part_id, from_location_id, to_location_id, quantity, avgCost, totalCost, JSON.stringify(layersMoved));

    return {
      part_number: part.part_number,
      from_location: fromLoc.name,
      to_location: toLoc.name,
      quantity_moved: quantity,
      total_cost: totalCost,
      fifo_layers_moved: layersMoved,
    };
  });

  try {
    const result = move();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/inventory/dispose - Dispose of inventory (Story 5.2)
router.post('/dispose', (req, res) => {
  const db = getDb();
  const { part_id, location_id, quantity, reason } = req.body;

  if (!part_id || !location_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'part_id, location_id, and positive quantity are required' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'reason is required for disposal (e.g., damaged, obsolete, expired)' });
  }

  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
  if (!part) return res.status(404).json({ error: 'Part not found' });

  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(location_id);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const inv = db.prepare('SELECT * FROM inventory WHERE part_id = ? AND location_id = ?').get(part_id, location_id);
  if (!inv || inv.quantity_on_hand < quantity) {
    return res.status(400).json({
      error: `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`
    });
  }

  const dispose = db.transaction(() => {
    // Consume FIFO layers oldest first
    const layers = db.prepare(`
      SELECT * FROM fifo_layers
      WHERE part_id = ? AND location_id = ? AND remaining_qty > 0
      ORDER BY created_at ASC, id ASC
    `).all(part_id, location_id);

    let remainingToDispose = quantity;
    let totalCost = 0;
    const layersConsumed = [];

    for (const layer of layers) {
      if (remainingToDispose <= 0) break;

      const consumeQty = Math.min(remainingToDispose, layer.remaining_qty);
      const consumeCost = consumeQty * layer.unit_cost;

      db.prepare('UPDATE fifo_layers SET remaining_qty = remaining_qty - ? WHERE id = ?')
        .run(consumeQty, layer.id);

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
    db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand - ? WHERE part_id = ? AND location_id = ?')
      .run(quantity, part_id, location_id);

    // Audit trail
    const avgCost = totalCost / quantity;
    db.prepare(`
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reason, fifo_layers_consumed)
      VALUES ('DISPOSE', ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
    `).run(part_id, location_id, -quantity, avgCost, -totalCost, reason, JSON.stringify(layersConsumed));

    return {
      part_number: part.part_number,
      location: location.name,
      quantity_disposed: quantity,
      total_cost: totalCost,
      reason,
      fifo_layers_consumed: layersConsumed,
    };
  });

  try {
    const result = dispose();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/inventory/issue - Issue parts (FIFO consumption) (Story 5.1)
router.post('/issue', (req, res) => {
  const db = getDb();
  const { part_id, location_id, quantity, reason, target_ref } = req.body;

  if (!part_id || !location_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'part_id, location_id, and positive quantity are required' });
  }

  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
  if (!part) return res.status(404).json({ error: 'Part not found' });

  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(location_id);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const inv = db.prepare('SELECT * FROM inventory WHERE part_id = ? AND location_id = ?').get(part_id, location_id);
  if (!inv || inv.quantity_on_hand < quantity) {
    return res.status(400).json({
      error: `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`
    });
  }

  const issue = db.transaction(() => {
    // Get FIFO layers oldest first
    const layers = db.prepare(`
      SELECT * FROM fifo_layers
      WHERE part_id = ? AND location_id = ? AND remaining_qty > 0
      ORDER BY created_at ASC, id ASC
    `).all(part_id, location_id);

    let remainingToIssue = quantity;
    let totalCost = 0;
    const layersConsumed = [];

    for (const layer of layers) {
      if (remainingToIssue <= 0) break;

      const consumeQty = Math.min(remainingToIssue, layer.remaining_qty);
      const consumeCost = consumeQty * layer.unit_cost;

      db.prepare('UPDATE fifo_layers SET remaining_qty = remaining_qty - ? WHERE id = ?')
        .run(consumeQty, layer.id);

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
    db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand - ? WHERE part_id = ? AND location_id = ?')
      .run(quantity, part_id, location_id);

    // Audit trail
    const avgCost = totalCost / quantity;
    db.prepare(`
      INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, target_ref, reason, fifo_layers_consumed)
      VALUES ('ISSUE', ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?)
    `).run(part_id, location_id, -quantity, avgCost, -totalCost, target_ref || null, reason || null, JSON.stringify(layersConsumed));

    return {
      part_number: part.part_number,
      location: location.name,
      quantity_issued: quantity,
      total_cost: totalCost,
      average_unit_cost: avgCost,
      target_ref: target_ref || null,
      fifo_layers_consumed: layersConsumed,
    };
  });

  try {
    const result = issue();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/inventory/transactions - Audit trail
router.get('/transactions', (req, res) => {
  const db = getDb();
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

  if (part_id) {
    conditions.push('t.part_id = ?');
    params.push(part_id);
  }
  if (location_id) {
    conditions.push('t.location_id = ?');
    params.push(location_id);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY t.created_at DESC LIMIT ?';
  params.push(limitVal);

  const transactions = db.prepare(sql).all(...params);
  res.json(transactions);
});

// GET /api/inventory/valuation - FIFO valuation report
router.get('/valuation', (req, res) => {
  const db = getDb();
  const { format } = req.query;

  const layers = db.prepare(`
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
  `).all();

  // Summary by part and location
  const summary = db.prepare(`
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
    GROUP BY fl.part_id, fl.location_id
    ORDER BY p.part_number, l.name
  `).all();

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
