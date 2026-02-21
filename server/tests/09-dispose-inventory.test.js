import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost, dbQuery } from './helpers/testHelpers.js';

describe('Dispose Inventory', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'DISPOSE-PART' });
    location = await createLocation({ name: 'Dispose Warehouse', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Dispose Supplier' });
  });

  // --- Happy Path ---

  test('Dispose inventory with reason', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
      reason: 'damaged',
    });
    expect(res.status).toBe(200);
    expect(res.body.quantity_disposed).toBe(3);
    expectCost(res.body.total_cost, 15.00);
    expect(res.body.reason).toBe('damaged');
    expect(res.body.fifo_layers_consumed.length).toBeGreaterThan(0);
  });

  test('Inventory decreases after dispose', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 4,
      reason: 'expired',
    });

    const inv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv[0].quantity_on_hand).toBe(6);
  });

  test('Audit trail with DISPOSE type and reason', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
      reason: 'obsolete',
    });

    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'DISPOSE']
    );
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].reason).toBe('obsolete');
  });

  test('FIFO consumption oldest first on dispose', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 20.00 });

    const res = await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 7,
      reason: 'damaged',
    });
    expect(res.status).toBe(200);
    // (5 * 10) + (2 * 20) = 90
    expectCost(res.body.total_cost, 90.00);

    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY id',
      [part.id, location.id]
    );
    expect(layers[0].remaining_qty).toBe(0);
    expect(layers[1].remaining_qty).toBe(3);
  });

  // --- Validation ---

  test('Missing reason returns 400', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  test('Insufficient inventory returns 400', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    const res = await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 100,
      reason: 'damaged',
    });
    expect(res.status).toBe(400);
  });

  test('Non-existent part returns 404', async () => {
    const res = await request(app).post('/api/inventory/dispose').send({
      part_id: 99999,
      location_id: location.id,
      quantity: 1,
      reason: 'damaged',
    });
    expect(res.status).toBe(404);
  });

  test('Zero quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 0,
      reason: 'damaged',
    });
    expect(res.status).toBe(400);
  });
});
