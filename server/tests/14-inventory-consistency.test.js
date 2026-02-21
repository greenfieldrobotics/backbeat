import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, assertInventoryConsistency, dbQuery } from './helpers/testHelpers.js';

describe('Inventory Summary Consistency', () => {
  let part, locA, locB, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'CONSIST-PART' });
    locA = await createLocation({ name: 'Consist Loc A', type: 'Warehouse' });
    locB = await createLocation({ name: 'Consist Loc B', type: 'Regional Site' });
    supplier = await createSupplier({ name: 'Consist Supplier' });
  });

  test('Consistency after receive', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await assertInventoryConsistency(part.id, locA.id);
  });

  test('Consistency after issue', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: locA.id,
      quantity: 3,
    });
    await assertInventoryConsistency(part.id, locA.id);
  });

  test('Consistency after move (both locations)', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 4,
    });
    await assertInventoryConsistency(part.id, locA.id);
    await assertInventoryConsistency(part.id, locB.id);
  });

  test('Consistency after dispose', async () => {
    await receiveInventory({ part, location: locA, supplier, quantity: 10, unitCost: 5.00 });
    await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: locA.id,
      quantity: 2,
      reason: 'damaged',
    });
    await assertInventoryConsistency(part.id, locA.id);
  });

  test('Consistency after full workflow 12C', async () => {
    // Receive at A: 5 @ $10, 5 @ $20
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 10.00 });
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 20.00 });

    // Move 7 from A to B
    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 7,
    });

    // Issue 6 from B
    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: locB.id,
      quantity: 6,
    });

    // Verify consistency at both locations
    await assertInventoryConsistency(part.id, locA.id);
    await assertInventoryConsistency(part.id, locB.id);
  });
});
