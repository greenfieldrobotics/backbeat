import request from 'supertest';
import app from '../../src/app.js';
import { query } from '../../src/db/connection.js';

/** Create a part via API, return the created part */
export async function createPart(overrides = {}) {
  const defaults = {
    part_number: `PART-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: 'Test part',
    unit_of_measure: 'EA',
    classification: 'General',
  };
  const body = { ...defaults, ...overrides };
  const res = await request(app).post('/api/parts').send(body);
  if (res.status !== 201) throw new Error(`Failed to create part: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Create a location via API, return the created location */
export async function createLocation(overrides = {}) {
  const defaults = {
    name: `LOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'Warehouse',
  };
  const body = { ...defaults, ...overrides };
  const res = await request(app).post('/api/locations').send(body);
  if (res.status !== 201) throw new Error(`Failed to create location: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Create a supplier via API, return the created supplier */
export async function createSupplier(overrides = {}) {
  const defaults = {
    name: `SUP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
  const body = { ...defaults, ...overrides };
  const res = await request(app).post('/api/suppliers').send(body);
  if (res.status !== 201) throw new Error(`Failed to create supplier: ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Full workflow to receive inventory: create PO, order it, and receive.
 * Returns { po, fifoLayer, inventoryRecord }
 */
export async function receiveInventory({ part, location, supplier, quantity, unitCost }) {
  // Create PO
  const poRes = await request(app).post('/api/purchase-orders').send({
    supplier_id: supplier.id,
    line_items: [{ part_id: part.id, quantity_ordered: quantity, unit_cost: unitCost }],
  });
  if (poRes.status !== 201) throw new Error(`Failed to create PO: ${JSON.stringify(poRes.body)}`);
  const po = poRes.body;

  // Set to Ordered
  await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

  // Receive
  const receiveRes = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
    location_id: location.id,
    items: [{ line_item_id: po.line_items[0].id, quantity_received: quantity }],
  });
  if (receiveRes.status !== 200) throw new Error(`Failed to receive: ${JSON.stringify(receiveRes.body)}`);

  return { po, receiveResult: receiveRes.body };
}

/**
 * Assert a cost value matches expected to 4 decimal places.
 */
export function expectCost(actual, expected) {
  expect(Number(actual)).toBeCloseTo(expected, 4);
}

/**
 * Query the database directly (for assertions beyond API responses).
 */
export async function dbQuery(sql, params) {
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Assert that inventory.quantity_on_hand matches SUM(fifo_layers.remaining_qty)
 * for a given part/location.
 */
export async function assertInventoryConsistency(partId, locationId) {
  const [inv] = await dbQuery(
    'SELECT quantity_on_hand FROM inventory WHERE part_id = $1 AND location_id = $2',
    [partId, locationId]
  );
  const [fifo] = await dbQuery(
    'SELECT COALESCE(SUM(remaining_qty), 0) as total FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
    [partId, locationId]
  );
  const invQty = inv ? inv.quantity_on_hand : 0;
  const fifoQty = Number(fifo.total);
  expect(invQty).toBe(fifoQty);
}

export { default as request } from 'supertest';
export { default as app } from '../../src/app.js';
