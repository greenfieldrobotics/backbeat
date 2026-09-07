// Phase 9 — scan-to-locate (G3.3). There is no dedicated endpoint: the client's Locate
// page (client/src/modules/gear/pages/LocatePage.tsx) calls the existing
// PUT /api/gear/assets/:id with only { location_id } in the body. This suite covers
// that specific partial-body usage, which the earlier Phase 4 tests (always sending a
// full body) never exercised: it must move the asset and write exactly one `moved`
// event, and must not disturb any other field.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

describe('Gear — Scan-to-locate (Phase 9)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool);
  });

  test('sending only location_id moves the asset and writes exactly one moved event', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');
    const locA = await request(app).post('/api/locations').send({ name: 'Warehouse A', type: 'Warehouse' });
    const locB = await request(app).post('/api/locations').send({ name: 'Warehouse B', type: 'Warehouse' });

    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'LOCATE-001',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
      location_id: locA.body.id,
      notes: 'do not touch',
    });

    const moved = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      location_id: locB.body.id,
    });

    expect(moved.status).toBe(200);
    expect(moved.body.location_id).toBe(locB.body.id);
    // Untouched fields keep their existing value — the partial body must not reset them.
    expect(moved.body.serial_number).toBe('LOCATE-001');
    expect(moved.body.notes).toBe('do not touch');
    expect(moved.body.asset_type_id).toBe(type.body.id);
    expect(moved.body.lifecycle_state_id).toBe(availableId);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const movedEvents = events.body.filter(e => e.event_type === 'moved');
    expect(movedEvents).toHaveLength(1);
    expect(movedEvents[0].location_name).toBe('Warehouse B');
  });

  test('moving to the same location the asset is already at writes no new event', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');
    const loc = await request(app).post('/api/locations').send({ name: 'Warehouse C', type: 'Warehouse' });

    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'LOCATE-002',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
      location_id: loc.body.id,
    });

    await request(app).put(`/api/gear/assets/${created.body.id}`).send({ location_id: loc.body.id });

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const movedEvents = events.body.filter(e => e.event_type === 'moved');
    expect(movedEvents).toHaveLength(0);
  });
});
