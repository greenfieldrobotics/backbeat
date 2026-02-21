import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, dbQuery } from './helpers/testHelpers.js';

describe('Issue Parts', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'ISSUE-PART' });
    location = await createLocation({ name: 'Issue Warehouse', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Issue Supplier' });
  });

  // --- Happy Path ---

  test('Issue parts with reason and target_ref', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
      reason: 'repair',
      target_ref: 'Bot-42',
    });
    expect(res.status).toBe(200);
    expect(res.body.quantity_issued).toBe(3);
    expect(res.body.total_cost).toBe(15.00);
    expect(res.body.fifo_layers_consumed).toBeDefined();
    expect(res.body.fifo_layers_consumed.length).toBeGreaterThan(0);
  });

  test('Inventory quantity decreases after issue', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
    });

    const inv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv[0].quantity_on_hand).toBe(7);
  });

  test('Audit trail logged with correct fields', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
      reason: 'repair',
      target_ref: 'Bot-42',
    });

    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'ISSUE']
    );
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(-3); // negative for issue
    expect(txns[0].reason).toBe('repair');
    expect(txns[0].target_ref).toBe('Bot-42');
    expect(txns[0].fifo_layers_consumed).toBeDefined();
    const consumed = JSON.parse(txns[0].fifo_layers_consumed);
    expect(consumed.length).toBeGreaterThan(0);
  });

  // --- Validation & Edge Cases ---

  test('Insufficient inventory returns 400', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  test('Zero inventory returns 400', async () => {
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });

  test('Non-existent part returns 404', async () => {
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: 99999,
      location_id: location.id,
      quantity: 1,
    });
    expect(res.status).toBe(404);
  });

  test('Non-existent location returns 404', async () => {
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: 99999,
      quantity: 1,
    });
    expect(res.status).toBe(404);
  });

  test('Zero quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 0,
    });
    expect(res.status).toBe(400);
  });

  test('Negative quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: -5,
    });
    expect(res.status).toBe(400);
  });

  test('Missing part_id returns 400', async () => {
    const res = await request(app).post('/api/inventory/issue').send({
      location_id: location.id,
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });

  test('Issue without reason or target_ref succeeds', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 1,
    });
    expect(res.status).toBe(200);
  });
});
