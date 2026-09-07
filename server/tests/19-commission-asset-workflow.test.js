import { truncateAllTables } from './setup/testSetup.js';
import {
  request, app, createPart, createLocation, createSupplier, receiveInventory, dbQuery,
} from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

// The commission-asset workflow spans TWO modules (Gear + Stash) in one transaction.
// These tests prove the module boundary does not prevent cross-module workflows, and
// that such workflows are atomic.
//
// Phase 2 renamed the asset's identity field (asset_tag -> serial_number) and replaced
// its free-text asset_type with asset_type_id, so the payload/assertions below changed
// with it — see server/tests/18-gear-assets.test.js's header comment for why
// initializeDatabase() runs again in beforeEach (truncateAllTables empties
// lifecycle_states and parties along with everything else).
describe('Cross-module workflow — commission asset', () => {
  let part, location, supplier, assetType;

  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool);
    part = await createPart({ part_number: 'GFB-1000', description: 'Cutter blade' });
    location = await createLocation({ name: 'Assembly Line', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Acme' });
    const typeRes = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    assetType = typeRes.body;
    // Stock 10 units at unit cost 5.00
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.0 });
  });

  test('Creates the asset AND issues consumed parts in one transaction', async () => {
    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { serial_number: 'SN-100', asset_type_id: assetType.id, location_id: location.id },
      consume: [{ part_id: part.id, location_id: location.id, quantity: 3 }],
    });

    expect(res.status).toBe(201);
    // Gear side: asset created, defaulted to 'In Use' by the workflow (not the
    // registration default of 'Available')
    expect(res.body.asset.serial_number).toBe('SN-100');
    expect(res.body.asset.lifecycle_state_name).toBe('In Use');
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
    expect(txn.target_ref).toBe('SN-100');
  });

  test('Rolls back the asset if a consumed part has insufficient inventory', async () => {
    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { serial_number: 'SN-FAIL', asset_type_id: assetType.id },
      consume: [{ part_id: part.id, location_id: location.id, quantity: 999 }], // more than stocked
    });

    expect(res.status).toBe(400);

    // Atomicity: the asset must NOT have been created
    const assets = await dbQuery('SELECT * FROM assets WHERE serial_number = $1', ['SN-FAIL']);
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
      asset: { serial_number: 'SN-BARE', asset_type_id: assetType.id },
    });
    expect(res.status).toBe(201);
    expect(res.body.asset.serial_number).toBe('SN-BARE');
    expect(res.body.parts_issued).toHaveLength(0);
  });

  test('Commissioning with no serial still creates the asset (serial is optional)', async () => {
    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { asset_type_id: assetType.id },
    });
    expect(res.status).toBe(201);
    expect(res.body.asset.serial_number).toBeNull();
  });
});
