// Gear Phase 3 — locations: is_inventory_location flag + three new types (Farm, In
// Transit, Customer Site). Purely additive to a shared core table, so this file uses
// literal API calls (DAMP) rather than server/tests/helpers/testHelpers.js's
// createLocation factory, which still exists for the (untouched) 03-locations.test.js.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app, dbQuery } from './helpers/testHelpers.js';

describe('Gear — Locations (Phase 3)', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  test('Create a location of each new type', async () => {
    const types = ['Farm', 'In Transit', 'Customer Site'];
    for (const type of types) {
      const res = await request(app).post('/api/locations').send({ name: `Test ${type}`, type });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
    }
  });

  test('New location defaults to is_inventory_location = true when omitted', async () => {
    const res = await request(app).post('/api/locations').send({ name: 'Default Flag', type: 'Warehouse' });
    expect(res.status).toBe(201);
    expect(res.body.is_inventory_location).toBe(true);
  });

  test('A location can be created explicitly as non-inventory', async () => {
    const res = await request(app).post('/api/locations').send({
      name: 'Field Site', type: 'Customer Site', is_inventory_location: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.is_inventory_location).toBe(false);
  });

  test('Filtered endpoint excludes non-inventory locations; unfiltered includes them', async () => {
    await request(app).post('/api/locations').send({ name: 'Main Warehouse', type: 'Warehouse' });
    await request(app).post('/api/locations').send({
      name: 'Customer Field', type: 'Customer Site', is_inventory_location: false,
    });

    const unfiltered = await request(app).get('/api/locations');
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.map(l => l.name).sort()).toEqual(['Customer Field', 'Main Warehouse']);

    const filtered = await request(app).get('/api/locations?inventory_only=true');
    expect(filtered.status).toBe(200);
    expect(filtered.body.map(l => l.name)).toEqual(['Main Warehouse']);
  });

  test('Updating without touching is_inventory_location preserves its current (false) value', async () => {
    const created = await request(app).post('/api/locations').send({
      name: 'Preserve Me', type: 'Farm', is_inventory_location: false,
    });

    const res = await request(app).put(`/api/locations/${created.body.id}`).send({ name: 'Preserve Me Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.is_inventory_location).toBe(false);
  });

  test('Update can flip is_inventory_location', async () => {
    const created = await request(app).post('/api/locations').send({
      name: 'Flip Me', type: 'Warehouse',
    });
    expect(created.body.is_inventory_location).toBe(true);

    const res = await request(app).put(`/api/locations/${created.body.id}`).send({ is_inventory_location: false });
    expect(res.status).toBe(200);
    expect(res.body.is_inventory_location).toBe(false);
  });

  // Simulates what the migration protects: a row that existed before this column did,
  // inserted with no opinion on the new flag at all (not even "omitted from a JSON
  // body" — literally absent from the INSERT). The column's own DB-level DEFAULT true
  // is what keeps it visible to Stash, independent of anything in the service layer.
  test('A location inserted with no is_inventory_location value defaults to true and stays visible to Stash', async () => {
    await dbQuery("INSERT INTO locations (name, type) VALUES ('Raw Insert', 'Warehouse')");

    const [row] = await dbQuery('SELECT is_inventory_location FROM locations WHERE name = $1', ['Raw Insert']);
    expect(row.is_inventory_location).toBe(true);

    const filtered = await request(app).get('/api/locations?inventory_only=true');
    expect(filtered.body.map(l => l.name)).toEqual(['Raw Insert']);
  });
});
