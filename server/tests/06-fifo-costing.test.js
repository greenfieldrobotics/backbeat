import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost, dbQuery } from './helpers/testHelpers.js';

describe('FIFO Costing Scenarios', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'FIFO-PART' });
    location = await createLocation({ name: 'FIFO Warehouse', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'FIFO Supplier' });
  });

  test('5A: Basic FIFO consumption across two layers', async () => {
    // Receive 10 @ $5.00, then 10 @ $7.00
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 7.00 });

    // Issue 15 units
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 15,
    });
    expect(res.status).toBe(200);

    // Total cost: (10 * 5) + (5 * 7) = 85
    expectCost(res.body.total_cost, 85.00);

    // Verify layers
    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY id',
      [part.id, location.id]
    );
    expect(layers[0].remaining_qty).toBe(0);  // Layer A fully consumed
    expect(layers[1].remaining_qty).toBe(5);  // Layer B partially consumed

    // Remaining value: 5 * 7 = 35
    const valRes = await request(app).get('/api/inventory/valuation');
    const partSummary = valRes.body.summary.find(s => s.part_number === part.part_number);
    expectCost(partSummary.total_value, 35.00);
  });

  test('5B: Exact layer depletion', async () => {
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 10,
    });
    expect(res.status).toBe(200);
    expectCost(res.body.total_cost, 50.00);

    // Inventory should be 0
    const inv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv[0].quantity_on_hand).toBe(0);

    // No active FIFO layers
    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0',
      [part.id, location.id]
    );
    expect(layers.length).toBe(0);
  });

  test('5C: Single unit from multiple layers', async () => {
    await receiveInventory({ part, location, supplier, quantity: 1, unitCost: 10.00 });
    await receiveInventory({ part, location, supplier, quantity: 1, unitCost: 20.00 });
    await receiveInventory({ part, location, supplier, quantity: 1, unitCost: 30.00 });

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 2,
    });
    expect(res.status).toBe(200);
    expectCost(res.body.total_cost, 30.00); // $10 + $20

    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY id',
      [part.id, location.id]
    );
    expect(layers[0].remaining_qty).toBe(0); // Layer A
    expect(layers[1].remaining_qty).toBe(0); // Layer B
    expect(layers[2].remaining_qty).toBe(1); // Layer C
  });

  test('5D: High-precision cost values', async () => {
    await receiveInventory({ part, location, supplier, quantity: 100, unitCost: 3.7525 });

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 37,
    });
    expect(res.status).toBe(200);

    // 37 * 3.7525 = 138.8425
    expectCost(res.body.total_cost, 138.8425);

    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(layers[0].remaining_qty).toBe(63);

    // Remaining value: 63 * 3.7525 = 236.4075
    const valRes = await request(app).get('/api/inventory/valuation');
    const partSummary = valRes.body.summary.find(s => s.part_number === part.part_number);
    expectCost(partSummary.total_value, 236.4075);
  });

  test('5E: Multiple receipts same cost - layers not merged', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    // Two distinct layers should exist
    const layersBefore = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY id',
      [part.id, location.id]
    );
    expect(layersBefore.length).toBe(2);

    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 7,
    });
    expect(res.status).toBe(200);
    expectCost(res.body.total_cost, 70.00);

    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY id',
      [part.id, location.id]
    );
    expect(layers[0].remaining_qty).toBe(0); // Layer A fully consumed
    expect(layers[1].remaining_qty).toBe(3); // Layer B: 5 - 2 = 3
  });
});
