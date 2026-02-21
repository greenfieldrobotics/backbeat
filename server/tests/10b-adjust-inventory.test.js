import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost, dbQuery, assertInventoryConsistency } from './helpers/testHelpers.js';

describe('Adjust Inventory (Story 5.5)', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'ADJUST-PART' });
    location = await createLocation({ name: 'Adjust Warehouse', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Adjust Supplier' });
  });

  // --- Negative Adjustment (shortage) ---

  test('Negative adjustment: 10 on hand, adjust to 7 — FIFO consumed, audit logged', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 7,
      reason: 'Physical count',
    });
    expect(res.status).toBe(200);
    expect(res.body.before_quantity).toBe(10);
    expect(res.body.after_quantity).toBe(7);
    expect(res.body.delta).toBe(-3);
    expectCost(res.body.total_cost, 15.00); // 3 * 5
    expect(res.body.fifo_layers_consumed).toBeDefined();
    expect(res.body.fifo_layers_consumed.length).toBe(1);
    expect(res.body.fifo_layers_consumed[0].quantity_consumed).toBe(3);

    // Verify inventory
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(7);

    // Verify FIFO layer
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0', [part.id]);
    expect(layers[0].remaining_qty).toBe(7);

    // Verify audit trail
    const txns = await dbQuery('SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2', [part.id, 'ADJUSTMENT']);
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].reason).toBe('Physical count');

    await assertInventoryConsistency(part.id, location.id);
  });

  test('8b-A: Negative adjustment spanning multiple FIFO layers', async () => {
    // Receive 5 @ $10, then 5 @ $20
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 20.00 });

    // Adjust from 10 to 3 (consume 7: all 5 @ $10 + 2 @ $20)
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 3,
      reason: 'Cycle count correction',
    });
    expect(res.status).toBe(200);
    expect(res.body.delta).toBe(-7);
    // Cost: (5 * 10) + (2 * 20) = 90
    expectCost(res.body.total_cost, 90.00);
    expect(res.body.fifo_layers_consumed.length).toBe(2);

    // Verify remaining: only 3 @ $20
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0', [part.id]);
    expect(layers.length).toBe(1);
    expect(layers[0].remaining_qty).toBe(3);
    expectCost(layers[0].unit_cost, 20.00);

    await assertInventoryConsistency(part.id, location.id);
  });

  test('8b-B: Negative adjustment to zero', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 0,
      reason: 'Physical count',
    });
    expect(res.status).toBe(200);
    expect(res.body.after_quantity).toBe(0);
    expect(res.body.delta).toBe(-5);
    expectCost(res.body.total_cost, 40.00);

    // Verify all FIFO layers depleted
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0', [part.id]);
    expect(layers.length).toBe(0);

    // Inventory is 0
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(0);

    await assertInventoryConsistency(part.id, location.id);
  });

  // --- Positive Adjustment (overage) ---

  test('Positive adjustment: 5 on hand, adjust to 8 — new ADJUSTMENT layer created', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 12.00 });

    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 8,
      reason: 'Physical count',
    });
    expect(res.status).toBe(200);
    expect(res.body.before_quantity).toBe(5);
    expect(res.body.after_quantity).toBe(8);
    expect(res.body.delta).toBe(3);
    // Should use most recent layer cost ($12) since no unit_cost provided
    expectCost(res.body.unit_cost, 12.00);
    expectCost(res.body.total_cost, 36.00);
    expect(res.body.fifo_layer_created).toBeDefined();
    expect(res.body.fifo_layer_created.source_type).toBe('ADJUSTMENT');
    expect(res.body.fifo_layer_created.original_qty).toBe(3);

    // Verify inventory
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(8);

    // Verify FIFO layers: original + adjustment
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0 ORDER BY created_at', [part.id]);
    expect(layers.length).toBe(2);
    expect(layers[0].source_type).toBe('PO_RECEIPT');
    expect(layers[1].source_type).toBe('ADJUSTMENT');
    expect(layers[1].remaining_qty).toBe(3);
    expectCost(layers[1].unit_cost, 12.00);

    await assertInventoryConsistency(part.id, location.id);
  });

  test('8b-C: Positive adjustment with specified cost', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 8,
      unit_cost: 15.00,
      reason: 'Receiving correction',
    });
    expect(res.status).toBe(200);
    expectCost(res.body.unit_cost, 15.00);
    expectCost(res.body.total_cost, 45.00); // 3 * 15

    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND source_type = $2', [part.id, 'ADJUSTMENT']);
    expect(layers.length).toBe(1);
    expectCost(layers[0].unit_cost, 15.00);

    await assertInventoryConsistency(part.id, location.id);
  });

  test('8b-D: Positive adjustment with no cost — uses most recent layer cost', async () => {
    // Receive 3 @ $7, then 3 @ $14
    await receiveInventory({ part, location, supplier, quantity: 3, unitCost: 7.00 });
    await receiveInventory({ part, location, supplier, quantity: 3, unitCost: 14.00 });

    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 8,
      reason: 'Physical count',
    });
    expect(res.status).toBe(200);
    // Should use most recent layer's cost ($14)
    expectCost(res.body.unit_cost, 14.00);
    expectCost(res.body.total_cost, 28.00); // 2 * 14

    await assertInventoryConsistency(part.id, location.id);
  });

  test('8b-E: Positive adjustment from zero inventory (with unit_cost)', async () => {
    // No existing inventory — need to provide unit_cost
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 5,
      unit_cost: 20.00,
      reason: 'Physical count',
    });
    expect(res.status).toBe(200);
    expect(res.body.before_quantity).toBe(0);
    expect(res.body.after_quantity).toBe(5);
    expect(res.body.delta).toBe(5);
    expectCost(res.body.unit_cost, 20.00);
    expectCost(res.body.total_cost, 100.00);

    // Verify inventory created from scratch
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, location.id]);
    expect(inv[0].quantity_on_hand).toBe(5);

    // Verify FIFO layer
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND source_type = $2', [part.id, 'ADJUSTMENT']);
    expect(layers.length).toBe(1);
    expect(layers[0].remaining_qty).toBe(5);

    await assertInventoryConsistency(part.id, location.id);
  });

  // --- No-op ---

  test('Count equals system — delta 0, no DB changes', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 10,
      reason: 'Physical count',
    });
    expect(res.status).toBe(200);
    expect(res.body.delta).toBe(0);
    expect(res.body.message).toBe('No adjustment needed');

    // No adjustment transactions
    const txns = await dbQuery('SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2', [part.id, 'ADJUSTMENT']);
    expect(txns.length).toBe(0);

    // No ADJUSTMENT layers
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND source_type = $2', [part.id, 'ADJUSTMENT']);
    expect(layers.length).toBe(0);
  });

  // --- Validation ---

  test('Missing part_id returns 400', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      location_id: location.id,
      new_quantity: 5,
      reason: 'Physical count',
    });
    expect(res.status).toBe(400);
  });

  test('Missing location_id returns 400', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      new_quantity: 5,
      reason: 'Physical count',
    });
    expect(res.status).toBe(400);
  });

  test('Missing new_quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      reason: 'Physical count',
    });
    expect(res.status).toBe(400);
  });

  test('Missing reason returns 400', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 5,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  test('Negative new_quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: -1,
      reason: 'Physical count',
    });
    expect(res.status).toBe(400);
  });

  test('Non-existent part returns 404', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: 99999,
      location_id: location.id,
      new_quantity: 5,
      reason: 'Physical count',
    });
    expect(res.status).toBe(404);
  });

  test('Non-existent location returns 404', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: 99999,
      new_quantity: 5,
      reason: 'Physical count',
    });
    expect(res.status).toBe(404);
  });

  test('Positive adjustment without cost and no existing layers returns 400', async () => {
    const res = await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 5,
      reason: 'Physical count',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unit_cost/i);
  });

  // --- Audit trail ---

  test('Negative adjustment audit trail has ADJUSTMENT type and reason', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 7,
      reason: 'Cycle count correction',
    });

    const txns = await dbQuery('SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2', [part.id, 'ADJUSTMENT']);
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].reason).toBe('Cycle count correction');
    expect(txns[0].fifo_layers_consumed).toBeDefined();
  });

  test('Positive adjustment audit trail has ADJUSTMENT type and reason', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    await request(app).post('/api/inventory/adjust').send({
      part_id: part.id,
      location_id: location.id,
      new_quantity: 8,
      reason: 'Receiving correction',
    });

    const txns = await dbQuery('SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2', [part.id, 'ADJUSTMENT']);
    expect(txns.length).toBe(1);
    expect(txns[0].quantity).toBe(3);
    expect(txns[0].reason).toBe('Receiving correction');
  });
});
