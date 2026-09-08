// Phase 12 — Gear Setup: asset_types self-seeding (G1.2) and the admin gate on the
// four reference-table CRUD endpoints the new Gear Setup screen calls
// (asset-types, lifecycle-states, asset-models, parties).
import { truncateAllTables } from './setup/testSetup.js';
import { request, app, dbQuery } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

describe('Gear Setup — asset_types self-seeding (Phase 12, G1.2)', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  test('a fresh database gets a starter set of asset types with no manual step', async () => {
    await initializeDatabase(pool);

    const rows = await dbQuery('SELECT name, supports_location, supports_linking, supports_maintenance, active FROM asset_types ORDER BY name');
    expect(rows).toEqual([
      { name: 'Drone', supports_location: false, supports_linking: false, supports_maintenance: false, active: true },
      { name: 'Laptop', supports_location: false, supports_linking: false, supports_maintenance: false, active: true },
      { name: 'RTK Base', supports_location: false, supports_linking: false, supports_maintenance: false, active: true },
      { name: 'Vehicle', supports_location: false, supports_linking: false, supports_maintenance: false, active: true },
    ]);
  });

  test('seeding is idempotent across two initializeDatabase() calls', async () => {
    await initializeDatabase(pool);
    await initializeDatabase(pool);

    const rows = await dbQuery('SELECT COUNT(*) AS count FROM asset_types');
    expect(Number(rows[0].count)).toBe(4);
  });

  test('an existing asset_types table is left alone — seeding only fires when empty', async () => {
    await initializeDatabase(pool);
    await request(app).post('/api/gear/asset-types').send({ name: 'Custom Type' });

    await initializeDatabase(pool);

    const rows = await dbQuery('SELECT COUNT(*) AS count FROM asset_types');
    expect(Number(rows[0].count)).toBe(5); // 4 seeded + the custom one, not re-seeded on top
  });
});

// requireAdmin (like requireAuth) bypasses entirely under NODE_ENV=test, and there
// is no login-simulation harness anywhere in this codebase to forge an authenticated
// non-admin session — the one precedent (server/tests/24-gear-label-route.test.js)
// only reaches requireAuth's real 401 branch by toggling NODE_ENV/GOOGLE_CLIENT_ID,
// which would prove nothing extra here: requireAuth already runs in front of every
// /api/* route (server/src/app.js) and 401s an unauthenticated request on its own,
// identically whether or not requireAdmin is *also* attached behind it. That
// approach can't tell "requireAdmin is wired to this route" apart from "requireAuth
// is wired to every route", so it isn't used below.
//
// Instead this asserts the actual thing that matters — which middleware functions
// Express attached to which routes — directly off each router's own `.stack`
// (Express exposes registered layers this way; `layer.route.stack` is the ordered
// handler chain for that path+method, and each handler's `.name` is the function's
// name, so `requireAdmin` shows up by name if and only if it's really in the
// chain). This fails the moment a mutation route loses its gate, or a GET route
// gains one it shouldn't have — the two mistakes that matter here — without
// needing any session machinery at all.
import assetTypesRouter from '../src/modules/gear/routes/assetTypes.js';
import lifecycleStatesRouter from '../src/modules/gear/routes/lifecycleStates.js';
import assetModelsRouter from '../src/modules/gear/routes/assetModels.js';
import partiesRouter from '../src/core/party/routes.js';
import { requireAdmin } from '../src/core/auth/authMiddleware.js';

function middlewareNames(router, path, method) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`No ${method.toUpperCase()} route registered for ${path}`);
  return layer.route.stack.map(l => l.name);
}

describe('Gear Setup — admin gate on reference-table mutations (Phase 12)', () => {
  test.each([
    ['asset-types', assetTypesRouter],
    ['lifecycle-states', lifecycleStatesRouter],
    ['asset-models', assetModelsRouter],
    ['parties (core, shared)', partiesRouter],
  ])('%s: POST/PUT/DELETE / carry requireAdmin, GET / does not', (_label, router) => {
    expect(middlewareNames(router, '/', 'get')).not.toContain(requireAdmin.name);
    expect(middlewareNames(router, '/', 'post')).toContain(requireAdmin.name);
    expect(middlewareNames(router, '/:id', 'put')).toContain(requireAdmin.name);
    expect(middlewareNames(router, '/:id', 'delete')).toContain(requireAdmin.name);
    expect(middlewareNames(router, '/:id', 'get')).not.toContain(requireAdmin.name);
  });
});

// requireAdmin's own branches — unaffected by any of the wiring above, so covered
// directly against the middleware function with mock req/res/next rather than
// through HTTP (bypassed under NODE_ENV=test either way, per the comment above).
describe('requireAdmin — role check (Phase 12)', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origClientId = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_CLIENT_ID = 'fake-id';
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = origClientId;
  });

  // Hand-rolled call trackers, not jest.fn() — this suite runs under
  // --experimental-vm-modules with no globals injection (see package.json's test
  // script), and nothing else in server/tests uses jest's mocking API; every
  // other test here is a real integration test against the DB, so there's no
  // existing convention for it to follow.
  function mockRes() {
    const res = { statusCalls: [], jsonCalls: [] };
    res.status = (code) => { res.statusCalls.push(code); return res; };
    res.json = (body) => { res.jsonCalls.push(body); return res; };
    return res;
  }

  test('rejects an unauthenticated request with 401', () => {
    const req = { isAuthenticated: () => false };
    const res = mockRes();
    let nextCalled = false;

    requireAdmin(req, res, () => { nextCalled = true; });

    expect(res.statusCalls).toEqual([401]);
    expect(nextCalled).toBe(false);
  });

  test('rejects an authenticated non-admin with 403', () => {
    const req = { isAuthenticated: () => true, user: { role: 'warehouse' } };
    const res = mockRes();
    let nextCalled = false;

    requireAdmin(req, res, () => { nextCalled = true; });

    expect(res.statusCalls).toEqual([403]);
    expect(nextCalled).toBe(false);
  });

  test('allows an authenticated admin through', () => {
    const req = { isAuthenticated: () => true, user: { role: 'admin' } };
    const res = mockRes();
    let nextCalled = false;

    requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(res.statusCalls).toEqual([]);
  });
});
