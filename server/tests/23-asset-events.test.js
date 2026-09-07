// Gear Phase 4 — the append-only asset_events stream (G3.2). New file, per the
// prompt: existing tests (18, 19) are untouched. DAMP-style literal API calls, no
// shared factory, following Phase 1-3's convention for new Gear coverage.
import { truncateAllTables } from './setup/testSetup.js';
import {
  request, app, dbQuery, createLocation, createPart, createSupplier, receiveInventory,
} from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

async function createAssetType(name) {
  const res = await request(app).post('/api/gear/asset-types').send({ name });
  return res.body.id;
}

async function createParty(name, party_type = 'customer') {
  const res = await request(app).post('/api/parties').send({ name, party_type });
  return res.body.id;
}

describe('Gear — Asset event stream (Phase 4)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
  });

  test('Registering an asset writes exactly one registered event', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');

    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId, serial_number: 'EVT-REG-1',
    });
    expect(created.status).toBe(201);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    expect(events.status).toBe(200);
    expect(events.body).toHaveLength(1);
    expect(events.body[0].event_type).toBe('registered');
    expect(events.body[0].asset_id).toBe(created.body.id);
  });

  test('A lifecycle state change writes exactly one event with the correct from_value/to_value', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const maintenanceId = await lifecycleStateId('Maintenance');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });

    const res = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      lifecycle_state_id: maintenanceId,
    });
    expect(res.status).toBe(200);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const stateEvents = events.body.filter(e => e.event_type === 'state_changed');
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0].from_value).toBe('Available');
    expect(stateEvents[0].to_value).toBe('Maintenance');
  });

  test('A location change writes exactly one moved event', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const loc = await createLocation({ name: 'New Warehouse', type: 'Warehouse' });
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });

    const res = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      location_id: loc.id,
    });
    expect(res.status).toBe(200);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const movedEvents = events.body.filter(e => e.event_type === 'moved');
    expect(movedEvents).toHaveLength(1);
    expect(movedEvents[0].location_id).toBe(loc.id);
    expect(movedEvents[0].location_name).toBe('New Warehouse');
  });

  test('A custody change writes exactly one custody_changed event with the correct from_value/to_value', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const customerId = await createParty('Acme Farms', 'customer');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });
    expect(created.body.custodian_party_name).toBeNull(); // no custodian yet

    const res = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      custodian_party_id: customerId,
    });
    expect(res.status).toBe(200);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const custodyEvents = events.body.filter(e => e.event_type === 'custody_changed');
    expect(custodyEvents).toHaveLength(1);
    expect(custodyEvents[0].from_value).toBeNull();
    expect(custodyEvents[0].to_value).toBe('Acme Farms');
    expect(custodyEvents[0].party_id).toBe(customerId);
  });

  test('Setting a field to the value it already has writes no event', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });

    const res = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      lifecycle_state_id: availableId, // unchanged
    });
    expect(res.status).toBe(200);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    expect(events.body).toHaveLength(1); // just the original `registered`
  });

  test('Events are returned newest-first by occurred_at', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const inUseId = await lifecycleStateId('In Use');
    const maintenanceId = await lifecycleStateId('Maintenance');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });

    await request(app).put(`/api/gear/assets/${created.body.id}`).send({ lifecycle_state_id: inUseId });
    await request(app).put(`/api/gear/assets/${created.body.id}`).send({ lifecycle_state_id: maintenanceId });

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    expect(events.body).toHaveLength(3); // registered, Available->In Use, In Use->Maintenance
    expect(events.body[0].to_value).toBe('Maintenance'); // newest first
    expect(events.body[1].to_value).toBe('In Use');
    expect(events.body[2].event_type).toBe('registered'); // oldest last
  });

  test('A failed asset update writes no event and leaves the asset unchanged', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const maintenanceId = await lifecycleStateId('Maintenance');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });

    // Would-be valid state change, bundled with an invalid location_id — the whole
    // request must fail, and neither part of it may leave a trace.
    const res = await request(app).put(`/api/gear/assets/${created.body.id}`).send({
      lifecycle_state_id: maintenanceId,
      location_id: 999999,
    });
    expect(res.status).toBe(404);

    const [row] = await dbQuery('SELECT lifecycle_state_id FROM assets WHERE id = $1', [created.body.id]);
    expect(row.lifecycle_state_id).toBe(availableId); // unchanged

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    expect(events.body).toHaveLength(1); // just the original `registered` — no state_changed
  });

  test('There is no API path that mutates or deletes an event', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId,
    });
    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const eventId = events.body[0].id;

    const putRes = await request(app).put(`/api/gear/assets/${created.body.id}/events/${eventId}`).send({ notes: 'edited' });
    expect(putRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/gear/assets/${created.body.id}/events/${eventId}`);
    expect(deleteRes.status).toBe(404);

    const stillThere = await dbQuery('SELECT * FROM asset_events WHERE id = $1', [eventId]);
    expect(stillThere).toHaveLength(1);
  });

  test('Events for a non-existent asset returns 404', async () => {
    const res = await request(app).get('/api/gear/assets/999999/events');
    expect(res.status).toBe(404);
  });

  test('commission-asset writes the asset AND its registered event together', async () => {
    const typeId = await createAssetType('Robot');
    const part = await createPart({ part_number: 'EVT-PART-1' });
    const location = await createLocation({ name: 'Assembly Line', type: 'Warehouse' });
    const supplier = await createSupplier({ name: 'Acme' });
    await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5.0 });

    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { asset_type_id: typeId, serial_number: 'EVT-COMM-1' },
      consume: [{ part_id: part.id, location_id: location.id, quantity: 2 }],
    });
    expect(res.status).toBe(201);

    const events = await request(app).get(`/api/gear/assets/${res.body.asset.id}/events`);
    expect(events.status).toBe(200);
    expect(events.body).toHaveLength(1);
    expect(events.body[0].event_type).toBe('registered');
  });

  test('A failed commission-asset writes neither the asset nor any event', async () => {
    const typeId = await createAssetType('Robot');
    const part = await createPart({ part_number: 'EVT-PART-FAIL' });
    const location = await createLocation({ name: 'Fail Line', type: 'Warehouse' });
    const supplier = await createSupplier({ name: 'Acme' });
    await receiveInventory({ part, location, supplier, quantity: 1, unitCost: 5.0 });

    const res = await request(app).post('/api/workflows/commission-asset').send({
      asset: { asset_type_id: typeId, serial_number: 'EVT-COMM-FAIL' },
      consume: [{ part_id: part.id, location_id: location.id, quantity: 999 }], // more than stocked
    });
    expect(res.status).toBe(400);

    const assets = await dbQuery('SELECT id FROM assets WHERE serial_number = $1', ['EVT-COMM-FAIL']);
    expect(assets).toHaveLength(0);

    const events = await dbQuery(
      `SELECT e.* FROM asset_events e
       JOIN assets a ON e.asset_id = a.id
       WHERE a.serial_number = $1`,
      ['EVT-COMM-FAIL']
    );
    expect(events).toHaveLength(0);
  });
});
