import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost, dbQuery } from './helpers/testHelpers.js';

describe('Move Inventory', () => {
  let part, locA, locB, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'MOVE-PART' });
    locA = await createLocation({ name: 'Location A', type: 'Warehouse' });
    locB = await createLocation({ name: 'Location B', type: 'Regional Site' });
    supplier = await createSupplier({ name: 'Move Supplier' });
  });

  // --- Happy Path ---

  test('Move inventory between locations', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 3,
    });
    expect(res.status).toBe(200);
    expect(res.body.quantity_moved).toBe(3);

    // Verify source and destination
    const invA = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locA.id]);
    const invB = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locB.id]);
    expect(invA[0].quantity_on_hand).toBe(7);
    expect(invB[0].quantity_on_hand).toBe(3);
  });

  test('FIFO layers transferred correctly', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 3,
    });

    const srcLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, locA.id]
    );
    expect(srcLayers[0].remaining_qty).toBe(7);

    const dstLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, locB.id]
    );
    expect(dstLayers.length).toBe(1);
    expect(dstLayers[0].original_qty).toBe(3);
    expect(dstLayers[0].remaining_qty).toBe(3);
    expect(dstLayers[0].unit_cost).toBe(5.00);
  });

  test('Audit trail with MOVE type', async () => {
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
    expect(txns[0].to_location_id).toBe(locB.id);
  });

  // --- Scenario 7A: Move splits a FIFO layer ---

  test('7A: Move splits a single FIFO layer', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });

    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 3,
    });

    const srcLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, locA.id]
    );
    expect(srcLayers[0].remaining_qty).toBe(7);
    expect(srcLayers[0].unit_cost).toBe(5.00);

    const dstLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, locB.id]
    );
    expect(dstLayers[0].original_qty).toBe(3);
    expect(dstLayers[0].remaining_qty).toBe(3);
    expect(dstLayers[0].unit_cost).toBe(5.00);
  });

  // --- Scenario 7B: Move spans multiple layers ---

  test('7B: Move spans multiple layers', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 10.00 });
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 20.00 });

    const res = await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 7,
    });
    expect(res.status).toBe(200);
    expectCost(res.body.total_cost, 90.00); // (5*10) + (2*20)

    // Source layers
    const srcLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY id',
      [part.id, locA.id]
    );
    expect(srcLayers[0].remaining_qty).toBe(0);
    expect(srcLayers[1].remaining_qty).toBe(3);

    // Destination layers
    const dstLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 ORDER BY unit_cost',
      [part.id, locB.id]
    );
    expect(dstLayers.length).toBe(2);
    expect(dstLayers[0].remaining_qty).toBe(5);
    expect(dstLayers[0].unit_cost).toBe(10.00);
    expect(dstLayers[1].remaining_qty).toBe(2);
    expect(dstLayers[1].unit_cost).toBe(20.00);
  });

  // --- Scenario 7C: Move to location with existing inventory ---

  test('7C: Move to location with existing inventory', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part, location: locB, supplier, quantity: 5, unitCost: 8.00 });

    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 3,
    });

    const invB = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locB.id]);
    expect(invB[0].quantity_on_hand).toBe(8); // 5 + 3

    // Destination should have 2 separate layers (not merged)
    const dstLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0 ORDER BY unit_cost',
      [part.id, locB.id]
    );
    expect(dstLayers.length).toBe(2);
    expect(dstLayers[0].unit_cost).toBe(5.00);
    expect(dstLayers[0].remaining_qty).toBe(3);
    expect(dstLayers[1].unit_cost).toBe(8.00);
    expect(dstLayers[1].remaining_qty).toBe(5);
  });

  // --- Validation ---

  test('Same source and destination returns 400', async () => {
    const res = await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locA.id,
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });

  test('Insufficient inventory returns 400', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 10.00 });

    const res = await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  test('Non-existent part returns 404', async () => {
    const res = await request(app).post('/api/inventory/move').send({
      part_id: 99999,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 1,
    });
    expect(res.status).toBe(404);
  });

  test('Zero quantity returns 400', async () => {
    const res = await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 0,
    });
    expect(res.status).toBe(400);
  });
});
