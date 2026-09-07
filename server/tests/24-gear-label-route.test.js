// Phase 5 (part 1) — the by-serial lookup behind the in-app label route `/a/:serial`
// (G2.2). The route itself is client-side (React Router); this suite covers the
// server lookup it calls: GET /api/gear/assets/by-serial/:serial.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

describe('Gear — Label route lookup (Phase 5)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
  });

  test('resolves an asset by its exact stored serial', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'GFR-0114',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
    });

    const res = await request(app).get('/api/gear/assets/by-serial/GFR-0114');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.serial_number).toBe('GFR-0114');
  });

  test('resolves regardless of case — a label scanned lowercase still matches (G2.1)', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');
    await request(app).post('/api/gear/assets').send({
      serial_number: 'GFR-0200',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
    });

    const res = await request(app).get('/api/gear/assets/by-serial/gfr-0200');
    expect(res.status).toBe(200);
    expect(res.body.serial_number).toBe('GFR-0200');
  });

  test('resolves with surrounding whitespace in the path segment — stray scanner input (G2.1)', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');
    await request(app).post('/api/gear/assets').send({
      serial_number: 'GFR-0301',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
    });

    const res = await request(app).get('/api/gear/assets/by-serial/' + encodeURIComponent('  GFR-0301  '));
    expect(res.status).toBe(200);
    expect(res.body.serial_number).toBe('GFR-0301');
  });

  test('an unknown serial 404s with a clear message, not a crash', async () => {
    const res = await request(app).get('/api/gear/assets/by-serial/NO-SUCH-SERIAL');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Asset not found');
  });

  test('does not collide with the numeric /:id route', async () => {
    const type = await request(app).post('/api/gear/asset-types').send({ name: 'Robot' });
    const availableId = await lifecycleStateId('Available');
    const created = await request(app).post('/api/gear/assets').send({
      serial_number: 'GFR-0400',
      asset_type_id: type.body.id,
      lifecycle_state_id: availableId,
    });

    const byId = await request(app).get(`/api/gear/assets/${created.body.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.serial_number).toBe('GFR-0400');

    const bySerial = await request(app).get('/api/gear/assets/by-serial/GFR-0400');
    expect(bySerial.status).toBe(200);
    expect(bySerial.body.id).toBe(created.body.id);
  });

  // The bar for this phase notes the E2E suite runs with auth bypassed, so the
  // unauthenticated case (§5.5: a scan by someone not logged in fails to a login
  // screen) can't be asserted there. Covered here instead by forcing requireAuth's
  // real branch: unset the NODE_ENV bypass and set GOOGLE_CLIENT_ID so the
  // `req.isAuthenticated()` check actually runs, same technique 00-auth.test.js
  // uses for /auth/me. NODE_ENV is only read by requireAuth/requireAdmin and the
  // session cookie's `secure` flag (see server/src/app.js), so toggling it around
  // a single request is safe.
  test('an unauthenticated request to the label lookup is rejected, not served (§5.5)', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origClientId = process.env.GOOGLE_CLIENT_ID;
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_CLIENT_ID = 'fake-id';

    try {
      const res = await request(app).get('/api/gear/assets/by-serial/GFR-0114');
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = origClientId;
    }
  });
});
