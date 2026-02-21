import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost, dbQuery, assertInventoryConsistency } from './helpers/testHelpers.js';

describe('Return Parts (Story 5.4)', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'RETURN-PART' });
    location = await createLocation({ name: 'Return Warehouse', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Return Supplier' });
  });

  // --- Happy Path ---

  test('Return 5 @ $10 — creates FIFO layer, updates inventory, creates audit trail', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 5,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(200);
    expect(res.body.part_number).toBe('RETURN-PART');
    expect(res.body.quantity_returned).toBe(5);
    expectCost(res.body.unit_cost, 10.00);
    expectCost(res.body.total_cost, 50.00);

    // Verify FIFO layer created
    expect(res.body.fifo_layer_created).toBeDefined();
    expect(res.body.fifo_layer_created.source_type).toBe('RETURN');
    expect(res.body.fifo_layer_created.original_qty).toBe(5);
    expect(res.body.fifo_layer_created.remaining_qty).toBe(5);
    expectCost(res.body.fifo_layer_created.unit_cost, 10.00);

    // Verify inventory
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(5);

    // Verify audit trail
    const txns = await dbQuery('SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2', [part.id, 'RETURN']);
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(5);
    expectCost(txns[0].unit_cost, 10.00);
    expectCost(txns[0].total_cost, 50.00);

    await assertInventoryConsistency(part.id, location.id);
  });

  test('Return with reason and reference — stored in audit trail', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
      unit_cost: 7.50,
      reason: 'unused from Bot #42',
      reference: 'ISSUE-2024-001',
    });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('unused from Bot #42');

    // Verify audit trail has reason and reference
    const txns = await dbQuery('SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2', [part.id, 'RETURN']);
    expect(txns[0].reason).toBe('unused from Bot #42');
    expect(txns[0].target_ref).toBe('ISSUE-2024-001');

    // Verify FIFO layer source_ref
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND source_type = $2', [part.id, 'RETURN']);
    expect(layers[0].source_ref).toBe('ISSUE-2024-001');
  });

  test('8a-A: Return after full issue — original layer unchanged, new return layer created', async () => {
    // Receive 10 @ $5
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    // Issue all 10
    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 10,
    });

    // Verify inventory is 0
    const inv0 = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv0[0].quantity_on_hand).toBe(0);

    // Return 5 @ $5 (same cost as original)
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 5,
      unit_cost: 5.00,
      reason: 'unused',
    });
    expect(res.status).toBe(200);
    expect(res.body.quantity_returned).toBe(5);

    // Original PO_RECEIPT layer should still be depleted
    const originalLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND source_type = $2',
      [part.id, 'PO_RECEIPT']
    );
    expect(originalLayers[0].remaining_qty).toBe(0);

    // New RETURN layer should exist
    const returnLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND source_type = $2',
      [part.id, 'RETURN']
    );
    expect(returnLayers.length).toBe(1);
    expect(returnLayers[0].remaining_qty).toBe(5);

    // Inventory should be 5
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(5);

    await assertInventoryConsistency(part.id, location.id);
  });

  test('8a-B: Return at different cost than original issue', async () => {
    // Receive 10 @ $5
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    // Issue 5
    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 5,
    });

    // Return 3 @ $8 (different cost)
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 3,
      unit_cost: 8.00,
    });
    expect(res.status).toBe(200);
    expectCost(res.body.unit_cost, 8.00);
    expectCost(res.body.total_cost, 24.00);

    // Verify FIFO: should have PO_RECEIPT layer (remaining 5) and RETURN layer (remaining 3)
    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0 ORDER BY created_at',
      [part.id]
    );
    expect(layers.length).toBe(2);
    expect(layers[0].source_type).toBe('PO_RECEIPT');
    expect(layers[0].remaining_qty).toBe(5);
    expectCost(layers[0].unit_cost, 5.00);
    expect(layers[1].source_type).toBe('RETURN');
    expect(layers[1].remaining_qty).toBe(3);
    expectCost(layers[1].unit_cost, 8.00);

    // Inventory = 5 + 3 = 8
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(8);

    await assertInventoryConsistency(part.id, location.id);
  });

  test('Return without reason or reference succeeds', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 2,
      unit_cost: 3.00,
    });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBeNull();
  });

  test('Return with zero unit_cost succeeds', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 1,
      unit_cost: 0,
    });
    expect(res.status).toBe(200);
    expectCost(res.body.unit_cost, 0);
    expectCost(res.body.total_cost, 0);
  });

  // --- Validation ---

  test('Missing part_id returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      location_id: location.id,
      quantity: 5,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(400);
  });

  test('Missing location_id returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      quantity: 5,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(400);
  });

  test('Missing quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(400);
  });

  test('Missing unit_cost returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 5,
    });
    expect(res.status).toBe(400);
  });

  test('Zero quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 0,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(400);
  });

  test('Negative quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: -5,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(400);
  });

  test('Negative unit_cost returns 400', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 5,
      unit_cost: -1,
    });
    expect(res.status).toBe(400);
  });

  test('Non-existent part returns 404', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: 99999,
      location_id: location.id,
      quantity: 5,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(404);
  });

  test('Non-existent location returns 404', async () => {
    const res = await request(app).post('/api/inventory/return').send({
      part_id: part.id,
      location_id: 99999,
      quantity: 5,
      unit_cost: 10.00,
    });
    expect(res.status).toBe(404);
  });
});
