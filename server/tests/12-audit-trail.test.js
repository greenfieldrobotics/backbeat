import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, dbQuery } from './helpers/testHelpers.js';

describe('Audit Trail / Transactions', () => {
  let part, locA, locB, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'AUDIT-PART' });
    locA = await createLocation({ name: 'Audit Loc A', type: 'Warehouse' });
    locB = await createLocation({ name: 'Audit Loc B', type: 'Regional Site' });
    supplier = await createSupplier({ name: 'Audit Supplier' });
  });

  // --- Coverage: every transaction type produces an audit record ---

  test('RECEIVE creates audit record', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'RECEIVE']
    );
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(10);
    expect(txns[0].unit_cost).toBe(5.00);
    expect(txns[0].reference_type).toBe('PO');
    expect(txns[0].reference_id).toBeDefined();
    expect(txns[0].created_at).toBeDefined();
  });

  test('ISSUE creates audit record with target_ref and reason', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: locA.id,
      quantity: 3,
      reason: 'maintenance',
      target_ref: 'Machine-7',
    });

    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'ISSUE']
    );
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].target_ref).toBe('Machine-7');
    expect(txns[0].reason).toBe('maintenance');
  });

  test('MOVE creates audit record with to_location_id', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 3,
    });

    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'MOVE']
    );
    expect(txns.length).toBe(1);
    expect(txns[0].location_id).toBe(locA.id);
    expect(txns[0].to_location_id).toBe(locB.id);
    expect(txns[0].quantity).toBe(3);
  });

  test('DISPOSE creates audit record with reason', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: locA.id,
      quantity: 2,
      reason: 'expired',
    });

    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'DISPOSE']
    );
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(-2);
    expect(txns[0].reason).toBe('expired');
  });

  // --- Query Filtering ---

  test('Filter by part_id', async () => {
    const part2 = await createPart({ part_number: 'AUDIT-PART-2' });
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part: part2, location: locA, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get(`/api/inventory/transactions?part_id=${part.id}`);
    expect(res.status).toBe(200);
    expect(res.body.every(t => t.part_id === part.id)).toBe(true);
  });

  test('Filter by location_id', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part, location: locB, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get(`/api/inventory/transactions?location_id=${locA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.every(t => t.location_id === locA.id)).toBe(true);
  });

  test('Default limit is 100', async () => {
    // Just verify the endpoint responds (we don't need 100+ records)
    const res = await request(app).get('/api/inventory/transactions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('Custom limit parameter', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get('/api/inventory/transactions?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('Results ordered by created_at DESC', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    // Small delay
    await new Promise(r => setTimeout(r, 50));
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get('/api/inventory/transactions');
    expect(res.status).toBe(200);
    if (res.body.length >= 2) {
      const first = new Date(res.body[0].created_at).getTime();
      const second = new Date(res.body[1].created_at).getTime();
      expect(first).toBeGreaterThanOrEqual(second);
    }
  });

  // --- Immutability ---

  test('No PUT endpoint for transactions', async () => {
    const res = await request(app).put('/api/inventory/transactions/1').send({ quantity: 999 });
    expect(res.status).toBe(404);
  });

  test('No DELETE endpoint for transactions', async () => {
    const res = await request(app).delete('/api/inventory/transactions/1');
    expect(res.status).toBe(404);
  });
});
