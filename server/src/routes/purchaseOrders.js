import { Router } from 'express';
import { query, getClient } from '../db/connection.js';

const router = Router();

// GET /api/purchase-orders - List all POs
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    ORDER BY po.created_at DESC
  `);
  res.json(rows);
});

// GET /api/purchase-orders/:id - Get PO with line items
router.get('/:id', async (req, res) => {
  const { rows: poRows } = await query(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = $1
  `, [req.params.id]);

  if (poRows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });

  const { rows: lineItems } = await query(`
    SELECT li.*, p.part_number, p.description as part_description
    FROM po_line_items li
    JOIN parts p ON li.part_id = p.id
    WHERE li.purchase_order_id = $1
  `, [req.params.id]);

  res.json({ ...poRows[0], line_items: lineItems });
});

// POST /api/purchase-orders - Create a PO
router.post('/', async (req, res) => {
  const { supplier_id, expected_delivery_date, line_items } = req.body;

  if (!supplier_id) {
    return res.status(400).json({ error: 'supplier_id is required' });
  }
  if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
    return res.status(400).json({ error: 'line_items array is required and must not be empty' });
  }

  const { rows: supplierRows } = await query('SELECT * FROM suppliers WHERE id = $1', [supplier_id]);
  if (supplierRows.length === 0) return res.status(400).json({ error: 'Supplier not found' });

  // Validate all parts exist
  for (const item of line_items) {
    if (!item.part_id || !item.quantity_ordered || !item.unit_cost) {
      return res.status(400).json({ error: 'Each line item requires part_id, quantity_ordered, and unit_cost' });
    }
    const { rows: partRows } = await query('SELECT * FROM parts WHERE id = $1', [item.part_id]);
    if (partRows.length === 0) return res.status(400).json({ error: `Part with id ${item.part_id} not found` });
  }

  // Generate PO number
  const { rows: lastPoRows } = await query('SELECT po_number FROM purchase_orders ORDER BY id DESC LIMIT 1');
  let nextNum = 1;
  if (lastPoRows.length > 0) {
    const match = lastPoRows[0].po_number.match(/PO-\d{4}-(\d+)/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }
  const year = new Date().getFullYear();
  const poNumber = `PO-${year}-${String(nextNum).padStart(3, '0')}`;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: poRows } = await client.query(`
      INSERT INTO purchase_orders (po_number, supplier_id, status, expected_delivery_date)
      VALUES ($1, $2, 'Draft', $3)
      RETURNING *
    `, [poNumber, supplier_id, expected_delivery_date || null]);

    const poId = poRows[0].id;

    for (const item of line_items) {
      await client.query(`
        INSERT INTO po_line_items (purchase_order_id, part_id, quantity_ordered, unit_cost)
        VALUES ($1, $2, $3, $4)
      `, [poId, item.part_id, item.quantity_ordered, item.unit_cost]);
    }

    await client.query('COMMIT');

    // Return full PO
    const { rows: fullPo } = await query(`
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = $1
    `, [poId]);
    const { rows: items } = await query(`
      SELECT li.*, p.part_number, p.description as part_description
      FROM po_line_items li
      JOIN parts p ON li.part_id = p.id
      WHERE li.purchase_order_id = $1
    `, [poId]);

    res.status(201).json({ ...fullPo[0], line_items: items });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/purchase-orders/:id/status - Update PO status
router.put('/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Draft', 'Ordered', 'Partially Received', 'Closed'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const { rows: poRows } = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
  if (poRows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });

  const { rows } = await query(`
    UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2
    RETURNING *
  `, [status, req.params.id]);

  const { rows: updated } = await query(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = $1
  `, [req.params.id]);
  res.json(updated[0]);
});

// POST /api/purchase-orders/:id/receive - Receive items against a PO
router.post('/:id/receive', async (req, res) => {
  const { location_id, items } = req.body;

  if (!location_id) return res.status(400).json({ error: 'location_id is required' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const { rows: poRows } = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
  if (poRows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });
  const po = poRows[0];
  if (po.status === 'Closed') return res.status(400).json({ error: 'Cannot receive against a closed PO' });
  if (po.status === 'Draft') return res.status(400).json({ error: 'PO must be in Ordered status to receive' });

  const { rows: locRows } = await query('SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) return res.status(400).json({ error: 'Location not found' });
  const location = locRows[0];

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const results = [];

    for (const item of items) {
      const { line_item_id, quantity_received } = item;
      if (!line_item_id || !quantity_received || quantity_received <= 0) {
        throw new Error('Each item requires line_item_id and positive quantity_received');
      }

      const { rows: liRows } = await client.query(`
        SELECT li.*, p.part_number
        FROM po_line_items li
        JOIN parts p ON li.part_id = p.id
        WHERE li.id = $1 AND li.purchase_order_id = $2
      `, [line_item_id, req.params.id]);

      if (liRows.length === 0) throw new Error(`Line item ${line_item_id} not found on this PO`);
      const lineItem = liRows[0];

      const remaining = lineItem.quantity_ordered - lineItem.quantity_received;
      if (quantity_received > remaining) {
        throw new Error(`Cannot receive ${quantity_received} of ${lineItem.part_number}. Only ${remaining} remaining.`);
      }

      // Update line item received qty
      await client.query(
        'UPDATE po_line_items SET quantity_received = quantity_received + $1 WHERE id = $2',
        [quantity_received, line_item_id]
      );

      // Create FIFO layer
      await client.query(`
        INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost)
        VALUES ($1, $2, 'PO_RECEIPT', $3, $4, $5, $6)
      `, [lineItem.part_id, location_id, po.po_number, quantity_received, quantity_received, lineItem.unit_cost]);

      // Update inventory
      await client.query(`
        INSERT INTO inventory (part_id, location_id, quantity_on_hand)
        VALUES ($1, $2, $3)
        ON CONFLICT(part_id, location_id) DO UPDATE SET quantity_on_hand = inventory.quantity_on_hand + $4
      `, [lineItem.part_id, location_id, quantity_received, quantity_received]);

      // Audit trail
      await client.query(`
        INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reference_id, reason)
        VALUES ('RECEIVE', $1, $2, $3, $4, $5, 'PO', $6, $7)
      `, [lineItem.part_id, location_id, quantity_received, lineItem.unit_cost, quantity_received * lineItem.unit_cost, po.id, `Received against ${po.po_number}`]);

      results.push({
        part_number: lineItem.part_number,
        quantity_received,
        unit_cost: lineItem.unit_cost,
        location: location.name,
      });
    }

    // Update PO status
    const { rows: allLines } = await client.query(
      'SELECT * FROM po_line_items WHERE purchase_order_id = $1',
      [req.params.id]
    );
    const allFullyReceived = allLines.every(l => l.quantity_received >= l.quantity_ordered);
    const anyReceived = allLines.some(l => l.quantity_received > 0);

    let newStatus = po.status;
    if (allFullyReceived) newStatus = 'Closed';
    else if (anyReceived) newStatus = 'Partially Received';

    await client.query(
      'UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ received: results, po_status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
