import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory } from './helpers/testHelpers.js';

describe('FIFO Layer Query Endpoint', () => {
  let partA, partB, loc1, loc2, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    partA = await createPart({ part_number: 'LAYER-A' });
    partB = await createPart({ part_number: 'LAYER-B' });
    loc1 = await createLocation({ name: 'Layer Loc 1', type: 'Warehouse' });
    loc2 = await createLocation({ name: 'Layer Loc 2', type: 'Regional Site' });
    supplier = await createSupplier({ name: 'Layer Supplier' });
  });

  test('Default returns only active layers (remaining_qty > 0)', async () => {
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 10, unitCost: 5.00 });

    // Deplete some by issuing all
    await request(app).post('/api/inventory/issue').send({
      part_id: partA.id,
      location_id: loc1.id,
      quantity: 10,
    });

    // Receive again so there's one active layer
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get('/api/inventory/fifo-layers');
    expect(res.status).toBe(200);
    // Only the active layer should appear
    expect(res.body.every(l => l.remaining_qty > 0)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  test('include_depleted=true returns all layers', async () => {
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 10, unitCost: 5.00 });
    await request(app).post('/api/inventory/issue').send({
      part_id: partA.id,
      location_id: loc1.id,
      quantity: 10,
    });
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get('/api/inventory/fifo-layers?include_depleted=true');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2); // depleted + active
  });

  test('Filter by part_id', async () => {
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part: partB, location: loc1, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get(`/api/inventory/fifo-layers?part_id=${partA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.every(l => l.part_id === partA.id)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  test('Filter by location_id', async () => {
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part: partA, location: loc2, supplier, quantity: 5, unitCost: 8.00 });

    const res = await request(app).get(`/api/inventory/fifo-layers?location_id=${loc1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.every(l => l.location_id === loc1.id)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  test('Combined part_id + location_id filter', async () => {
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part: partA, location: loc2, supplier, quantity: 5, unitCost: 8.00 });
    await receiveInventory({ part: partB, location: loc1, supplier, quantity: 3, unitCost: 12.00 });

    const res = await request(app).get(`/api/inventory/fifo-layers?part_id=${partA.id}&location_id=${loc1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].part_id).toBe(partA.id);
    expect(res.body[0].location_id).toBe(loc1.id);
  });

  test('Sort order: part_id, location_id, created_at ASC', async () => {
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 5, unitCost: 5.00 });
    await receiveInventory({ part: partA, location: loc1, supplier, quantity: 3, unitCost: 8.00 });
    await receiveInventory({ part: partB, location: loc1, supplier, quantity: 10, unitCost: 2.00 });

    const res = await request(app).get('/api/inventory/fifo-layers');
    expect(res.status).toBe(200);
    // partA should come before partB (by part_id)
    const partAIdx = res.body.findIndex(l => l.part_number === 'LAYER-A');
    const partBIdx = res.body.findIndex(l => l.part_number === 'LAYER-B');
    expect(partAIdx).toBeLessThan(partBIdx);

    // Within partA, layers should be oldest first
    const partALayers = res.body.filter(l => l.part_number === 'LAYER-A');
    expect(partALayers[0].unit_cost).toBe(5.00); // first receipt
    expect(partALayers[1].unit_cost).toBe(8.00); // second receipt
  });
});
