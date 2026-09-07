// Stash purchase-order services — all SQL for `purchase_orders` and `po_line_items`
// lives here, plus the receiving path that turns a receipt into FIFO layers.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument. `createPurchaseOrder` and `receivePurchaseOrder` write across several
// tables and MUST be given a client inside a transaction — see `withTransaction`.

import { httpError } from '../../../core/http.js';

export const VALID_STATUSES = ['Draft', 'Ordered', 'Partially Received', 'Closed'];

// A PO always travels with its supplier's name.
const PO_WITH_SUPPLIER = `
  SELECT po.*, s.name as supplier_name
  FROM purchase_orders po
  JOIN suppliers s ON po.supplier_id = s.id
`;

// Line items always travel with the part they refer to.
const LINE_ITEMS_WITH_PART = `
  SELECT li.*, p.part_number, p.description as part_description
  FROM po_line_items li
  JOIN parts p ON li.part_id = p.id
  WHERE li.purchase_order_id = $1
`;

export async function listPurchaseOrders(db) {
  const { rows } = await db.query(`${PO_WITH_SUPPLIER} ORDER BY po.created_at DESC`);
  return rows;
}

/** One PO with its line items attached. */
export async function getPurchaseOrder(db, id) {
  const { rows: poRows } = await db.query(`${PO_WITH_SUPPLIER} WHERE po.id = $1`, [id]);
  if (poRows.length === 0) throw httpError('Purchase order not found', 404);

  const { rows: lineItems } = await db.query(LINE_ITEMS_WITH_PART, [id]);
  return { ...poRows[0], line_items: lineItems };
}

/** Next PO number in the PO-YYYY-NNN series. */
async function nextPoNumber(db) {
  const { rows } = await db.query('SELECT po_number FROM purchase_orders ORDER BY id DESC LIMIT 1');
  let nextNum = 1;
  if (rows.length > 0) {
    const match = rows[0].po_number.match(/PO-\d{4}-(\d+)/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }
  const year = new Date().getFullYear();
  return `PO-${year}-${String(nextNum).padStart(3, '0')}`;
}

/**
 * Create a Draft PO with its line items. Needs a client inside a transaction —
 * the header and every line item commit together or not at all.
 */
export async function createPurchaseOrder(client, { supplier_id, expected_delivery_date, line_items }) {
  if (!supplier_id) {
    throw httpError('supplier_id is required', 400);
  }
  if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
    throw httpError('line_items array is required and must not be empty', 400);
  }

  const { rows: supplierRows } = await client.query('SELECT * FROM suppliers WHERE id = $1', [supplier_id]);
  if (supplierRows.length === 0) throw httpError('Supplier not found', 400);

  // Validate all parts exist before writing anything
  for (const item of line_items) {
    if (!item.part_id || !item.quantity_ordered || !item.unit_cost) {
      throw httpError('Each line item requires part_id, quantity_ordered, and unit_cost', 400);
    }
    const { rows: partRows } = await client.query('SELECT * FROM parts WHERE id = $1', [item.part_id]);
    if (partRows.length === 0) throw httpError(`Part with id ${item.part_id} not found`, 400);
  }

  const poNumber = await nextPoNumber(client);

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

  return getPurchaseOrder(client, poId);
}

export async function updatePurchaseOrderStatus(db, id, status) {
  if (!status || !VALID_STATUSES.includes(status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }

  const { rows: poRows } = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
  if (poRows.length === 0) throw httpError('Purchase order not found', 404);

  await db.query(
    'UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  );

  const { rows: updated } = await db.query(`${PO_WITH_SUPPLIER} WHERE po.id = $1`, [id]);
  return updated[0];
}

/**
 * Receive items against a PO. Needs a client inside a transaction: each received line
 * bumps the line item, opens a FIFO layer, raises inventory and writes an audit row,
 * and the PO status is recalculated from the result.
 */
export async function receivePurchaseOrder(client, id, { location_id, items }) {
  if (!location_id) throw httpError('location_id is required', 400);
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw httpError('items array is required', 400);
  }

  const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
  if (poRows.length === 0) throw httpError('Purchase order not found', 404);
  const po = poRows[0];
  if (po.status === 'Closed') throw httpError('Cannot receive against a closed PO', 400);
  if (po.status === 'Draft') throw httpError('PO must be in Ordered status to receive', 400);

  const { rows: locRows } = await client.query('SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) throw httpError('Location not found', 400);
  const location = locRows[0];

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
    `, [line_item_id, id]);

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

  // Recalculate PO status from what is now on the lines
  const { rows: allLines } = await client.query(
    'SELECT * FROM po_line_items WHERE purchase_order_id = $1',
    [id]
  );
  const allFullyReceived = allLines.every(l => l.quantity_received >= l.quantity_ordered);
  const anyReceived = allLines.some(l => l.quantity_received > 0);

  let newStatus = po.status;
  if (allFullyReceived) newStatus = 'Closed';
  else if (anyReceived) newStatus = 'Partially Received';

  await client.query(
    'UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2',
    [newStatus, id]
  );

  return { received: results, po_status: newStatus };
}
