import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/purchase-orders - List all POs
router.get('/', (req, res) => {
  const db = getDb();
  const pos = db.prepare(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    ORDER BY po.created_at DESC
  `).all();
  res.json(pos);
});

// GET /api/purchase-orders/:id - Get PO with line items
router.get('/:id', (req, res) => {
  const db = getDb();
  const po = db.prepare(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = ?
  `).get(req.params.id);

  if (!po) return res.status(404).json({ error: 'Purchase order not found' });

  const lineItems = db.prepare(`
    SELECT li.*, p.part_number, p.description as part_description
    FROM po_line_items li
    JOIN parts p ON li.part_id = p.id
    WHERE li.purchase_order_id = ?
  `).all(req.params.id);

  res.json({ ...po, line_items: lineItems });
});

// POST /api/purchase-orders - Create a PO
router.post('/', (req, res) => {
  const db = getDb();
  const { supplier_id, expected_delivery_date, line_items } = req.body;

  if (!supplier_id) {
    return res.status(400).json({ error: 'supplier_id is required' });
  }
  if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
    return res.status(400).json({ error: 'line_items array is required and must not be empty' });
  }

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) return res.status(400).json({ error: 'Supplier not found' });

  // Validate all parts exist
  for (const item of line_items) {
    if (!item.part_id || !item.quantity_ordered || !item.unit_cost) {
      return res.status(400).json({ error: 'Each line item requires part_id, quantity_ordered, and unit_cost' });
    }
    const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(item.part_id);
    if (!part) return res.status(400).json({ error: `Part with id ${item.part_id} not found` });
  }

  // Generate PO number
  const lastPo = db.prepare("SELECT po_number FROM purchase_orders ORDER BY id DESC LIMIT 1").get();
  let nextNum = 1;
  if (lastPo) {
    const match = lastPo.po_number.match(/PO-\d{4}-(\d+)/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }
  const year = new Date().getFullYear();
  const poNumber = `PO-${year}-${String(nextNum).padStart(3, '0')}`;

  const createPo = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO purchase_orders (po_number, supplier_id, status, expected_delivery_date)
      VALUES (?, ?, 'Draft', ?)
    `).run(poNumber, supplier_id, expected_delivery_date || null);

    const poId = result.lastInsertRowid;

    const insertLine = db.prepare(`
      INSERT INTO po_line_items (purchase_order_id, part_id, quantity_ordered, unit_cost)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of line_items) {
      insertLine.run(poId, item.part_id, item.quantity_ordered, item.unit_cost);
    }

    return poId;
  });

  const poId = createPo();

  // Return full PO
  const po = db.prepare(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = ?
  `).get(poId);
  const items = db.prepare(`
    SELECT li.*, p.part_number, p.description as part_description
    FROM po_line_items li
    JOIN parts p ON li.part_id = p.id
    WHERE li.purchase_order_id = ?
  `).all(poId);

  res.status(201).json({ ...po, line_items: items });
});

// PUT /api/purchase-orders/:id/status - Update PO status
router.put('/:id/status', (req, res) => {
  const db = getDb();
  const { status } = req.body;
  const validStatuses = ['Draft', 'Ordered', 'Partially Received', 'Closed'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });

  db.prepare(`
    UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, req.params.id);

  const updated = db.prepare(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = ?
  `).get(req.params.id);
  res.json(updated);
});

// POST /api/purchase-orders/:id/receive - Receive items against a PO
router.post('/:id/receive', (req, res) => {
  const db = getDb();
  const { location_id, items } = req.body;

  if (!location_id) return res.status(400).json({ error: 'location_id is required' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status === 'Closed') return res.status(400).json({ error: 'Cannot receive against a closed PO' });
  if (po.status === 'Draft') return res.status(400).json({ error: 'PO must be in Ordered status to receive' });

  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(location_id);
  if (!location) return res.status(400).json({ error: 'Location not found' });

  const receive = db.transaction(() => {
    const results = [];

    for (const item of items) {
      const { line_item_id, quantity_received } = item;
      if (!line_item_id || !quantity_received || quantity_received <= 0) {
        throw new Error('Each item requires line_item_id and positive quantity_received');
      }

      const lineItem = db.prepare(`
        SELECT li.*, p.part_number
        FROM po_line_items li
        JOIN parts p ON li.part_id = p.id
        WHERE li.id = ? AND li.purchase_order_id = ?
      `).get(line_item_id, req.params.id);

      if (!lineItem) throw new Error(`Line item ${line_item_id} not found on this PO`);

      const remaining = lineItem.quantity_ordered - lineItem.quantity_received;
      if (quantity_received > remaining) {
        throw new Error(`Cannot receive ${quantity_received} of ${lineItem.part_number}. Only ${remaining} remaining.`);
      }

      // Update line item received qty
      db.prepare('UPDATE po_line_items SET quantity_received = quantity_received + ? WHERE id = ?')
        .run(quantity_received, line_item_id);

      // Create FIFO layer
      db.prepare(`
        INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost)
        VALUES (?, ?, 'PO_RECEIPT', ?, ?, ?, ?)
      `).run(lineItem.part_id, location_id, po.po_number, quantity_received, quantity_received, lineItem.unit_cost);

      // Update inventory
      db.prepare(`
        INSERT INTO inventory (part_id, location_id, quantity_on_hand)
        VALUES (?, ?, ?)
        ON CONFLICT(part_id, location_id) DO UPDATE SET quantity_on_hand = quantity_on_hand + ?
      `).run(lineItem.part_id, location_id, quantity_received, quantity_received);

      // Audit trail
      db.prepare(`
        INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reference_id, reason)
        VALUES ('RECEIVE', ?, ?, ?, ?, ?, 'PO', ?, ?)
      `).run(lineItem.part_id, location_id, quantity_received, lineItem.unit_cost, quantity_received * lineItem.unit_cost, po.id, `Received against ${po.po_number}`);

      results.push({
        part_number: lineItem.part_number,
        quantity_received,
        unit_cost: lineItem.unit_cost,
        location: location.name,
      });
    }

    // Update PO status
    const allLines = db.prepare('SELECT * FROM po_line_items WHERE purchase_order_id = ?').all(req.params.id);
    const allFullyReceived = allLines.every(l => l.quantity_received >= l.quantity_ordered);
    const anyReceived = allLines.some(l => l.quantity_received > 0);

    let newStatus = po.status;
    if (allFullyReceived) newStatus = 'Closed';
    else if (anyReceived) newStatus = 'Partially Received';

    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newStatus, req.params.id);

    return { received: results, po_status: newStatus };
  });

  try {
    const result = receive();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
