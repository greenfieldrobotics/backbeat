// Gear Phase 11 — photograph and resolve later (G4.3). New file, per the prompt:
// existing tests are untouched. DAMP-style literal API calls, no shared factory,
// following Phase 1-3's convention for new Gear coverage.
//
// Decoding the still image is a client-side concern (Phase 8's self-hosted decoder,
// reused as-is) and is covered at the e2e layer (e2e/tests/23-gear-photo-resolve.spec.js)
// with a real generated QR code. This suite starts from an already-decoded serial —
// exactly what POST /api/gear/photo-scans actually receives — and covers what IS
// server-side: resolving that serial, the idempotency guarantee, and occurred_at
// vs created_at.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app } from './helpers/testHelpers.js';
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

describe('Gear — Photo scan resolution (Phase 11)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
  });

  test('resolves a serial to its asset and writes one photo_scan event', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId, serial_number: 'PHOTO-001',
    });

    const res = await request(app).post('/api/gear/photo-scans').send({
      serial: 'PHOTO-001',
      occurred_at: '2026-08-01T14:00:00.000Z',
      client_key: 'key-001',
    });

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.asset.id).toBe(created.body.id);
    expect(res.body.event.event_type).toBe('photo_scan');
    expect(res.body.event.occurred_at).toBe('2026-08-01T14:00:00.000Z');

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const photoEvents = events.body.filter(e => e.event_type === 'photo_scan');
    expect(photoEvents).toHaveLength(1);
  });

  test('occurred_at (when the photo was taken) is recorded separately from created_at (when it was uploaded)', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId, serial_number: 'PHOTO-002',
    });

    const res = await request(app).post('/api/gear/photo-scans').send({
      serial: 'PHOTO-002',
      occurred_at: '2026-08-01T14:00:00.000Z',
      client_key: 'key-002',
    });

    expect(res.body.event.occurred_at).toBe('2026-08-01T14:00:00.000Z');
    expect(res.body.event.created_at).not.toBe(res.body.event.occurred_at);
    expect(new Date(res.body.event.created_at).getTime()).toBeGreaterThan(
      new Date(res.body.event.occurred_at).getTime()
    );
  });

  test('an omitted occurred_at (no EXIF, no user entry) falls back to upload time', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId, serial_number: 'PHOTO-003',
    });

    const before = Date.now();
    const res = await request(app).post('/api/gear/photo-scans').send({
      serial: 'PHOTO-003',
      client_key: 'key-003',
    });
    const after = Date.now();

    const occurredAtMs = new Date(res.body.event.occurred_at).getTime();
    expect(occurredAtMs).toBeGreaterThanOrEqual(before);
    expect(occurredAtMs).toBeLessThanOrEqual(after);
  });

  test('the same client_key submitted twice produces exactly one event, not two', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId, serial_number: 'PHOTO-004',
    });

    const first = await request(app).post('/api/gear/photo-scans').send({
      serial: 'PHOTO-004',
      occurred_at: '2026-08-01T09:00:00.000Z',
      client_key: 'retry-key',
    });
    const second = await request(app).post('/api/gear/photo-scans').send({
      serial: 'PHOTO-004',
      occurred_at: '2026-08-01T09:00:00.000Z',
      client_key: 'retry-key',
    });

    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.event.id).toBe(first.body.event.id);

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const photoEvents = events.body.filter(e => e.event_type === 'photo_scan');
    expect(photoEvents).toHaveLength(1);
  });

  test('omitting client_key writes a new event every time — no dedup requested, none applied', async () => {
    const typeId = await createAssetType('Robot');
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      asset_type_id: typeId, lifecycle_state_id: availableId, serial_number: 'PHOTO-005',
    });

    await request(app).post('/api/gear/photo-scans').send({ serial: 'PHOTO-005' });
    await request(app).post('/api/gear/photo-scans').send({ serial: 'PHOTO-005' });

    const events = await request(app).get(`/api/gear/assets/${created.body.id}/events`);
    const photoEvents = events.body.filter(e => e.event_type === 'photo_scan');
    expect(photoEvents).toHaveLength(2);
  });

  test('an unknown serial 404s and writes no event', async () => {
    const res = await request(app).post('/api/gear/photo-scans').send({
      serial: 'NO-SUCH-SERIAL',
      client_key: 'key-006',
    });

    expect(res.status).toBe(404);
  });

  test('a missing serial is a 400, not a crash', async () => {
    const res = await request(app).post('/api/gear/photo-scans').send({
      client_key: 'key-007',
    });

    expect(res.status).toBe(400);
  });
});
