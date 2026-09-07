// Phase 1 — reference tables (parties, asset_types, lifecycle_states, asset_models).
// Purely additive: nothing in the rest of the app reads these tables yet, so these
// tests only exercise the new admin routes and the schema's own seeding behaviour.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app, dbQuery } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

describe('Gear — Reference tables (Phase 1)', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  describe('Parties', () => {
    test('Create a party with name and party_type', async () => {
      const res = await request(app).post('/api/parties').send({
        name: 'Acme Robotics',
        party_type: 'vendor',
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Acme Robotics');
      expect(res.body.party_type).toBe('vendor');
      expect(res.body.active).toBe(true); // default
    });

    test('Missing name returns 400', async () => {
      const res = await request(app).post('/api/parties').send({ party_type: 'vendor' });
      expect(res.status).toBe(400);
    });

    test('Invalid party_type returns 400', async () => {
      const res = await request(app).post('/api/parties').send({
        name: 'Someone',
        party_type: 'alien',
      });
      expect(res.status).toBe(400);
    });

    test('List parties sorted by name', async () => {
      await request(app).post('/api/parties').send({ name: 'Zeta Corp', party_type: 'customer' });
      await request(app).post('/api/parties').send({ name: 'Alpha LLC', party_type: 'customer' });

      const res = await request(app).get('/api/parties');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].name).toBe('Alpha LLC');
      expect(res.body[1].name).toBe('Zeta Corp');
    });

    test('Get a single party by id', async () => {
      const created = await request(app).post('/api/parties').send({
        name: 'Royce Farms',
        party_type: 'customer',
      });
      const res = await request(app).get(`/api/parties/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Royce Farms');
    });

    test('Get a non-existent party returns 404', async () => {
      const res = await request(app).get('/api/parties/999999');
      expect(res.status).toBe(404);
    });

    test('Update a party name and active flag', async () => {
      const created = await request(app).post('/api/parties').send({
        name: 'LeaseCo',
        party_type: 'internal_entity',
      });
      const res = await request(app).put(`/api/parties/${created.body.id}`).send({
        name: 'LeaseCo Holdings',
        active: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('LeaseCo Holdings');
      expect(res.body.active).toBe(false);
      expect(res.body.party_type).toBe('internal_entity'); // unchanged
    });

    test('Delete a party', async () => {
      const created = await request(app).post('/api/parties').send({
        name: 'Temp Vendor',
        party_type: 'vendor',
      });
      const del = await request(app).delete(`/api/parties/${created.body.id}`);
      expect(del.status).toBe(204);

      const get = await request(app).get(`/api/parties/${created.body.id}`);
      expect(get.status).toBe(404);
    });
  });

  describe('Asset Types', () => {
    test('Create an asset type with only name defaults every capability flag to false', async () => {
      const res = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Robot');
      expect(res.body.description).toBeNull();
      expect(res.body.supports_location).toBe(false);
      expect(res.body.supports_linking).toBe(false);
      expect(res.body.supports_maintenance).toBe(false);
      expect(res.body.active).toBe(true);
    });

    test('Create an asset type with explicit capability flags', async () => {
      const res = await request(app).post('/api/gear/asset-types').send({
        name: 'VCU',
        description: 'Vehicle control unit',
        supports_location: true,
        supports_linking: true,
        supports_maintenance: false,
      });
      expect(res.status).toBe(201);
      expect(res.body.supports_location).toBe(true);
      expect(res.body.supports_linking).toBe(true);
      expect(res.body.supports_maintenance).toBe(false);
    });

    test('Missing name returns 400', async () => {
      const res = await request(app).post('/api/gear/asset-types').send({ description: 'no name' });
      expect(res.status).toBe(400);
    });

    test('Duplicate name returns 409', async () => {
      await request(app).post('/api/gear/asset-types').send({ name: 'Battery' });
      const res = await request(app).post('/api/gear/asset-types').send({ name: 'Battery' });
      expect(res.status).toBe(409);
    });

    test('List asset types sorted by name', async () => {
      await request(app).post('/api/gear/asset-types').send({ name: 'Vehicle' });
      await request(app).post('/api/gear/asset-types').send({ name: 'Bin' });

      const res = await request(app).get('/api/gear/asset-types');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].name).toBe('Bin');
      expect(res.body[1].name).toBe('Vehicle');
    });

    test('Get a single asset type by id', async () => {
      const created = await request(app).post('/api/gear/asset-types').send({ name: 'Trailer' });
      const res = await request(app).get(`/api/gear/asset-types/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Trailer');
    });

    test('Get a non-existent asset type returns 404', async () => {
      const res = await request(app).get('/api/gear/asset-types/999999');
      expect(res.status).toBe(404);
    });

    test('Update an asset type capability flag', async () => {
      const created = await request(app).post('/api/gear/asset-types').send({ name: 'Tool' });
      const res = await request(app).put(`/api/gear/asset-types/${created.body.id}`).send({
        supports_maintenance: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.supports_maintenance).toBe(true);
      expect(res.body.name).toBe('Tool'); // unchanged
    });

    test('Renaming an asset type to an existing name returns 409', async () => {
      await request(app).post('/api/gear/asset-types').send({ name: 'Drone' });
      const other = await request(app).post('/api/gear/asset-types').send({ name: 'Sensor' });

      const res = await request(app).put(`/api/gear/asset-types/${other.body.id}`).send({ name: 'Drone' });
      expect(res.status).toBe(409);
    });

    test('Delete an asset type', async () => {
      const created = await request(app).post('/api/gear/asset-types').send({ name: 'Scrap' });
      const del = await request(app).delete(`/api/gear/asset-types/${created.body.id}`);
      expect(del.status).toBe(204);

      const get = await request(app).get(`/api/gear/asset-types/${created.body.id}`);
      expect(get.status).toBe(404);
    });
  });

  describe('Lifecycle States', () => {
    test('Create a lifecycle state', async () => {
      const res = await request(app).post('/api/gear/lifecycle-states').send({
        name: 'On Order',
        sort_order: 0,
      });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('On Order');
      expect(res.body.is_terminal).toBe(false); // default
      expect(res.body.active).toBe(true); // default
    });

    test('sort_order defaults to 0 when omitted', async () => {
      const res = await request(app).post('/api/gear/lifecycle-states').send({ name: 'Quarantined' });
      expect(res.status).toBe(201);
      expect(res.body.sort_order).toBe(0);
    });

    test('Missing name returns 400', async () => {
      const res = await request(app).post('/api/gear/lifecycle-states').send({ sort_order: 1 });
      expect(res.status).toBe(400);
    });

    test('Duplicate name returns 409', async () => {
      await request(app).post('/api/gear/lifecycle-states').send({ name: 'Scrapped' });
      const res = await request(app).post('/api/gear/lifecycle-states').send({ name: 'Scrapped' });
      expect(res.status).toBe(409);
    });

    test('List lifecycle states sorted by sort_order', async () => {
      await request(app).post('/api/gear/lifecycle-states').send({ name: 'Third', sort_order: 3 });
      await request(app).post('/api/gear/lifecycle-states').send({ name: 'First', sort_order: 1 });

      const res = await request(app).get('/api/gear/lifecycle-states');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].name).toBe('First');
      expect(res.body[1].name).toBe('Third');
    });

    test('Get a non-existent lifecycle state returns 404', async () => {
      const res = await request(app).get('/api/gear/lifecycle-states/999999');
      expect(res.status).toBe(404);
    });

    test('Update a lifecycle state to terminal', async () => {
      const created = await request(app).post('/api/gear/lifecycle-states').send({ name: 'Written Off', sort_order: 9 });
      const res = await request(app).put(`/api/gear/lifecycle-states/${created.body.id}`).send({
        is_terminal: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.is_terminal).toBe(true);
    });

    test('Delete a lifecycle state', async () => {
      const created = await request(app).post('/api/gear/lifecycle-states').send({ name: 'Junk', sort_order: 5 });
      const del = await request(app).delete(`/api/gear/lifecycle-states/${created.body.id}`);
      expect(del.status).toBe(204);

      const get = await request(app).get(`/api/gear/lifecycle-states/${created.body.id}`);
      expect(get.status).toBe(404);
    });
  });

  describe('Asset Models', () => {
    test('Create an asset model against an existing asset type', async () => {
      const type = await request(app).post('/api/gear/asset-types').send({ name: 'Battery Pack' });

      const res = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'Contoso',
        model_name: 'Pack Type B',
        specs: { voltage: 48, cells: 13 },
      });
      expect(res.status).toBe(201);
      expect(res.body.manufacturer).toBe('Contoso');
      expect(res.body.model_name).toBe('Pack Type B');
      expect(res.body.specs).toEqual({ voltage: 48, cells: 13 });
      expect(res.body.active).toBe(true); // default
    });

    test('Missing manufacturer returns 400', async () => {
      const type = await request(app).post('/api/gear/asset-types').send({ name: 'VCU2' });
      const res = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        model_name: 'No Manufacturer',
      });
      expect(res.status).toBe(400);
    });

    test('Nonexistent asset_type_id returns 400', async () => {
      const res = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: 999999,
        manufacturer: 'Ghost Co',
        model_name: 'Phantom',
      });
      expect(res.status).toBe(400);
    });

    test('Duplicate (manufacturer, model_name) returns 409', async () => {
      const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot Model Type' });
      await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'Fetch',
        model_name: 'R-100',
      });
      const res = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'Fetch',
        model_name: 'R-100',
      });
      expect(res.status).toBe(409);
    });

    test('Same model_name from a different manufacturer is allowed', async () => {
      const type = await request(app).post('/api/gear/asset-types').send({ name: 'Sensor Type' });
      await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'Fetch',
        model_name: 'R-100',
      });
      const res = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'OtherCo',
        model_name: 'R-100',
      });
      expect(res.status).toBe(201);
    });

    test('Get a non-existent asset model returns 404', async () => {
      const res = await request(app).get('/api/gear/asset-models/999999');
      expect(res.status).toBe(404);
    });

    test('Update an asset model specs', async () => {
      const type = await request(app).post('/api/gear/asset-types').send({ name: 'Trailer Model Type' });
      const created = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'Wabash',
        model_name: 'T-2000',
        specs: { axles: 2 },
      });
      const res = await request(app).put(`/api/gear/asset-models/${created.body.id}`).send({
        specs: { axles: 3 },
      });
      expect(res.status).toBe(200);
      expect(res.body.specs).toEqual({ axles: 3 });
      expect(res.body.manufacturer).toBe('Wabash'); // unchanged
    });

    test('Delete an asset model', async () => {
      const type = await request(app).post('/api/gear/asset-types').send({ name: 'Disposable Model Type' });
      const created = await request(app).post('/api/gear/asset-models').send({
        asset_type_id: type.body.id,
        manufacturer: 'Throwaway',
        model_name: 'X-1',
      });
      const del = await request(app).delete(`/api/gear/asset-models/${created.body.id}`);
      expect(del.status).toBe(204);

      const get = await request(app).get(`/api/gear/asset-models/${created.body.id}`);
      expect(get.status).toBe(404);
    });
  });

  describe('Seeding', () => {
    test('initializeDatabase seeds the four lifecycle states', async () => {
      await initializeDatabase(pool);

      const rows = await dbQuery('SELECT name, sort_order, is_terminal FROM lifecycle_states ORDER BY sort_order');
      expect(rows).toEqual([
        { name: 'Available', sort_order: 1, is_terminal: false },
        { name: 'In Use', sort_order: 2, is_terminal: false },
        { name: 'Maintenance', sort_order: 3, is_terminal: false },
        { name: 'Retired', sort_order: 4, is_terminal: true },
      ]);
    });

    test('initializeDatabase seeds Greenfield as an internal_entity party', async () => {
      await initializeDatabase(pool);

      const rows = await dbQuery('SELECT name, party_type, active FROM parties');
      expect(rows).toEqual([
        { name: 'Greenfield', party_type: 'internal_entity', active: true },
      ]);
    });

    test('seeding is idempotent across two initializeDatabase() calls', async () => {
      await initializeDatabase(pool);
      await initializeDatabase(pool);

      const states = await dbQuery('SELECT COUNT(*) AS count FROM lifecycle_states');
      expect(Number(states[0].count)).toBe(4);

      const parties = await dbQuery('SELECT COUNT(*) AS count FROM parties');
      expect(Number(parties[0].count)).toBe(1);
    });
  });
});
