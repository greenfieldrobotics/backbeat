// Gear Phase 2 migrated `assets` off free-text asset_tag/asset_type/status onto
// serial_number (optional, unique-when-present) + FKs into asset_types and
// lifecycle_states. truncateAllTables() empties those reference tables too (they
// were added to it in Phase 1), so every test here reseeds via initializeDatabase()
// and creates its own asset_type literally (DAMP — no shared asset factory).
import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createLocation } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

describe('Gear — Assets', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
  });

  // --- Happy Path ---

  test('Create an asset with serial and asset type', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');

    const res = await request(app).post('/api/gear/assets').send({
      serial_number: 'sn-abc-123',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.serial_number).toBe('SN-ABC-123'); // normalized: trimmed + uppercased (G2.1)
    expect(res.body.asset_type_name).toBe('Robot');
    expect(res.body.lifecycle_state_name).toBe('Available');
  });

  test('An asset registers with only asset_type_id and lifecycle_state_id — everything else is optional (G1.1)', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Bare Type' });
    const availableId = await lifecycleStateId('Available');

    const res = await request(app).post('/api/gear/assets').send({
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
    });
    expect(res.status).toBe(201);
    expect(res.body.serial_number).toBeNull();
    expect(res.body.location_id).toBeNull();
    expect(res.body.notes).toBeNull();
  });

  test('Two assets with no serial coexist', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'No-Serial Type' });
    const availableId = await lifecycleStateId('Available');

    const first = await request(app).post('/api/gear/assets').send({
      asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });
    const second = await request(app).post('/api/gear/assets').send({
      asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.serial_number).toBeNull();
    expect(second.body.serial_number).toBeNull();
  });

  test('owner_party_id defaults to the Greenfield party when omitted (G1.5)', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Owned Type' });
    const availableId = await lifecycleStateId('Available');

    const res = await request(app).post('/api/gear/assets').send({
      asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });
    expect(res.status).toBe(201);
    expect(res.body.owner_party_name).toBe('Greenfield');
  });

  test('List assets sorted by serial_number, with location and type names joined', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Tool' });
    const availableId = await lifecycleStateId('Available');
    const loc = await createLocation({ name: 'Robot Bay', type: 'Warehouse' });

    await request(app).post('/api/gear/assets').send({
      serial_number: 'ZZZ-9', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });
    await request(app).post('/api/gear/assets').send({
      serial_number: 'AAA-1', asset_type_id: type.body.id, lifecycle_state_id: availableId, location_id: loc.id,
    });

    const res = await request(app).get('/api/gear/assets');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].serial_number).toBe('AAA-1');
    expect(res.body[0].location_name).toBe('Robot Bay'); // cross-module join to shared locations
    expect(res.body[1].serial_number).toBe('ZZZ-9');
    expect(res.body[1].location_name).toBeNull();
  });

  test('Get a single asset by id', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Get Type' });
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'GET-1', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });

    const res = await request(app).get(`/api/gear/assets/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.serial_number).toBe('GET-1');
  });

  test('Update an asset lifecycle state and location', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Update Type' });
    const availableId = await lifecycleStateId('Available');
    const maintenanceId = await lifecycleStateId('Maintenance');
    const loc = await createLocation({ name: 'Maintenance Shop', type: 'Warehouse' });
    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'UPD-1', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });

    const res = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      lifecycle_state_id: maintenanceId,
      location_id: loc.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state_name).toBe('Maintenance');
    expect(res.body.location_id).toBe(loc.id);
  });

  test('Delete an asset', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Delete Type' });
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'DEL-1', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });

    const res = await request(app).delete(`/api/gear/assets/${created.body.id}`);
    expect(res.status).toBe(204);
    const check = await request(app).get(`/api/gear/assets/${created.body.id}`);
    expect(check.status).toBe(404);
  });

  // --- Validation / Errors ---

  test('Missing asset_type_id returns 400', async () => {
    const availableId = await lifecycleStateId('Available');
    const res = await request(app).post('/api/gear/assets').send({ lifecycle_state_id: availableId });
    expect(res.status).toBe(400);
  });

  test('Missing lifecycle_state_id returns 400', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'No State Type' });
    const res = await request(app).post('/api/gear/assets').send({ asset_type_id: type.body.id });
    expect(res.status).toBe(400);
  });

  test('Duplicate serial_number returns 409', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Dup Type' });
    const availableId = await lifecycleStateId('Available');
    await request(app).post('/api/gear/assets').send({
      serial_number: 'DUP-1', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });

    const res = await request(app).post('/api/gear/assets').send({
      serial_number: 'DUP-1', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });
    expect(res.status).toBe(409);
  });

  test('Duplicate serial_number is still rejected after normalization (different case/whitespace)', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Dup Case Type' });
    const availableId = await lifecycleStateId('Available');
    await request(app).post('/api/gear/assets').send({
      serial_number: 'dup-case-1', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });

    const res = await request(app).post('/api/gear/assets').send({
      serial_number: '  DUP-CASE-1  ', asset_type_id: type.body.id, lifecycle_state_id: availableId,
    });
    expect(res.status).toBe(409);
  });

  // Old behaviour: an invalid free-text `status` returned 400 (it failed a fixed
  // enum CHECK). status is now lifecycle_state_id, an FK — an unrecognized value is
  // "doesn't exist" rather than "not one of a fixed set", so this is a 404 now, the
  // same way an invalid location_id already was in this file before this migration.
  test('Non-existent lifecycle_state_id returns 404', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Bad State Type' });
    const res = await request(app).post('/api/gear/assets').send({
      asset_type_id: type.body.id,
      lifecycle_state_id: 999999,
    });
    expect(res.status).toBe(404);
  });

  test('Non-existent asset_type_id returns 404', async () => {
    const availableId = await lifecycleStateId('Available');
    const res = await request(app).post('/api/gear/assets').send({
      asset_type_id: 999999,
      lifecycle_state_id: availableId,
    });
    expect(res.status).toBe(404);
  });

  test('Create with non-existent location returns 404', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'No Loc Type' });
    const availableId = await lifecycleStateId('Available');
    const res = await request(app).post('/api/gear/assets').send({
      asset_type_id: type.body.id, lifecycle_state_id: availableId, location_id: 999999,
    });
    expect(res.status).toBe(404);
  });

  test('Get non-existent asset returns 404', async () => {
    const res = await request(app).get('/api/gear/assets/999999');
    expect(res.status).toBe(404);
  });
});
