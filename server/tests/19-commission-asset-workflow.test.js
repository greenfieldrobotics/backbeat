import { truncateAllTables } from './setup/testSetup.js';
import {
  request, app, createPart, createLocation, createSupplier, receiveInventory, dbQuery,
} from './helpers/testHelpers.js';

// The commission-asset workflow spans TWO modules (Gear + Stash) in one transaction.
// These tests prove the module boundary does not prevent cross-module workflows, and
// that such workflows are atomic.
describe('Cross-module workflow — commission asset', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'GFB-1000', description: 'Cutter blade' });
    location = await createLocation({ name: 'Assembly Line', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Acme' });
    // Stock 10 units at unit cost 5.00
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.0 });
  });

  test('Creates the asset AND issues consumed parts in one transaction', async () => {
    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { asset_tag: 'ROBOT-100', serial_number: 'SN-100', asset_type: 'Robot', location_id: location.id },
      consume: [{ part_id: part.id, location_id: location.id, quantity: 3 }],
    });

    expect(res.status).toBe(201);
    // Gear side: asset created
    expect(res.body.asset.asset_tag).toBe('ROBOT-100');
    expect(res.body.asset.status).toBe('In Use');
    expect(res.body.asset.id).toBeDefined();
    // Stash side: parts issued
    expect(res.body.parts_issued).toHaveLength(1);
    expect(res.body.parts_issued[0].quantity_issued).toBe(3);

    // Inventory was decremented 10 -> 7
    const [inv] = await dbQuery(
      'SELECT quantity_on_hand FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv.quantity_on_hand).toBe(7);

    // The issue transaction references the new asset (cross-module link recorded)
    const [txn] = await dbQuery(
      `SELECT * FROM inventory_transactions WHERE transaction_type = 'ISSUE' ORDER BY id DESC LIMIT 1`
    );
    expect(txn.reference_type).toBe('ASSET');
    expect(txn.reference_id).toBe(res.body.asset.id);
    expect(txn.target_ref).toBe('ROBOT-100');
  });

  test('Rolls back the asset if a consumed part has insufficient inventory', async () => {
    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { asset_tag: 'ROBOT-FAIL', asset_type: 'Robot' },
      consume: [{ part_id: part.id, location_id: location.id, quantity: 999 }], // more than stocked
    });

    expect(res.status).toBe(400);

    // Atomicity: the asset must NOT have been created
    const assets = await dbQuery('SELECT * FROM assets WHERE asset_tag = $1', ['ROBOT-FAIL']);
    expect(assets).toHaveLength(0);

    // And inventory is untouched (still 10)
    const [inv] = await dbQuery(
      'SELECT quantity_on_hand FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv.quantity_on_hand).toBe(10);
  });

  test('Commissioning with no consumed parts still creates the asset', async () => {
    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { asset_tag: 'ROBOT-BARE', asset_type: 'Robot' },
    });
    expect(res.status).toBe(201);
    expect(res.body.asset.asset_tag).toBe('ROBOT-BARE');
    expect(res.body.parts_issued).toHaveLength(0);
  });
});
