// Phase 10 — maintenance orders (G6.1) and component wear by model (G6.3),
// re-scoped after Stash went on hold (requirements §1, §7.8). G6.2 (parts consumed)
// is deferred, not built: these tests deliberately assert there is nowhere on a
// maintenance order to record a part or a quantity.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

async function createMaintainableType(name) {
  const res = await request(app).post('/api/gear/asset-types').send({ name, supports_maintenance: true });
  return res.body.id;
}

async function createNonMaintainableType(name) {
  const res = await request(app).post('/api/gear/asset-types').send({ name });
  return res.body.id;
}

async function createAsset(assetTypeId, serial) {
  const availableId = await lifecycleStateId('Available');
  const res = await request(app).post('/api/gear/assets').send({
    serial_number: serial,
    asset_type_id: assetTypeId,
    lifecycle_state_id: availableId,
  });
  return res.body;
}

async function createModel(assetTypeId, manufacturer, modelName) {
  const res = await request(app).post('/api/gear/asset-models').send({
    asset_type_id: assetTypeId,
    manufacturer,
    model_name: modelName,
  });
  return res.body;
}

describe('Gear — Maintenance orders (Phase 10, G6.1)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
  });

  test('opens a work order against an L3 asset', async () => {
    const robotType = await createMaintainableType('Robot');
    const robot = await createAsset(robotType, 'ROBOT-001');

    const res = await request(app).post('/api/gear/maintenance-orders').send({
      asset_id: robot.id,
      description: 'Left drive motor grinding',
    });

    expect(res.status).toBe(201);
    expect(res.body.asset_id).toBe(robot.id);
    expect(res.body.status).toBe('open');
    expect(res.body.description).toBe('Left drive motor grinding');
    expect(res.body.opened_at).toBeTruthy();
    expect(res.body.closed_at).toBeNull();
  });

  test('rejects a work order against a non-L3 asset with a clear 400', async () => {
    const beaconType = await createNonMaintainableType('Beacon');
    const beacon = await createAsset(beaconType, 'BEACON-001');

    const res = await request(app).post('/api/gear/maintenance-orders').send({
      asset_id: beacon.id,
      description: 'Blinking wrong',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not support maintenance/i);
  });

  test('advances a work order open -> in_progress -> closed, stamping closed_at once', async () => {
    const robotType = await createMaintainableType('Robot');
    const robot = await createAsset(robotType, 'ROBOT-002');
    const opened = await request(app).post('/api/gear/maintenance-orders').send({ asset_id: robot.id });

    const inProgress = await request(app)
      .patch(`/api/gear/maintenance-orders/${opened.body.id}`)
      .send({ status: 'in_progress' });
    expect(inProgress.status).toBe(200);
    expect(inProgress.body.status).toBe('in_progress');
    expect(inProgress.body.closed_at).toBeNull();

    const closed = await request(app)
      .patch(`/api/gear/maintenance-orders/${opened.body.id}`)
      .send({ status: 'closed', description: 'Replaced left drive motor' });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.description).toBe('Replaced left drive motor');
    expect(closed.body.closed_at).toBeTruthy();
  });

  test('a closed order cannot be reopened', async () => {
    const robotType = await createMaintainableType('Robot');
    const robot = await createAsset(robotType, 'ROBOT-003');
    const opened = await request(app).post('/api/gear/maintenance-orders').send({ asset_id: robot.id });
    await request(app).patch(`/api/gear/maintenance-orders/${opened.body.id}`).send({ status: 'closed' });

    const reopened = await request(app)
      .patch(`/api/gear/maintenance-orders/${opened.body.id}`)
      .send({ status: 'open' });

    expect(reopened.status).toBe(409);
    expect(reopened.body.error).toMatch(/cannot be reopened/i);
  });

  test('an asset\'s service history lists its maintenance orders, newest first, with no parts-consumed field anywhere', async () => {
    const robotType = await createMaintainableType('Robot');
    const robot = await createAsset(robotType, 'ROBOT-004');
    const first = await request(app).post('/api/gear/maintenance-orders').send({ asset_id: robot.id, description: 'First' });
    const second = await request(app).post('/api/gear/maintenance-orders').send({ asset_id: robot.id, description: 'Second' });

    const history = await request(app).get(`/api/gear/assets/${robot.id}/maintenance-orders`);

    expect(history.status).toBe(200);
    expect(history.body.map(o => o.id)).toEqual([second.body.id, first.body.id]);
    for (const order of history.body) {
      expect(Object.keys(order)).not.toEqual(expect.arrayContaining(['parts', 'parts_consumed', 'quantity', 'part_id']));
    }
  });

  test('an unknown asset 404s on both the create and the history routes', async () => {
    const create = await request(app).post('/api/gear/maintenance-orders').send({ asset_id: 999999 });
    expect(create.status).toBe(404);

    const history = await request(app).get('/api/gear/assets/999999/maintenance-orders');
    expect(history.status).toBe(404);
  });
});

describe('Gear — Component installations (Phase 10, G6.3)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool);
  });

  test('installs a component against a model, not against an asset of its own', async () => {
    const robotType = await createMaintainableType('Robot');
    const bladeType = await createNonMaintainableType('Blade'); // blades stay inventory (§5.6) — never registered as assets
    const robot = await createAsset(robotType, 'ROBOT-010');
    const model = await createModel(bladeType, 'Acme', 'Carbide Blade v2');

    const res = await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id,
      installed_on_asset_id: robot.id,
      installed_at_hours: 120.5,
    });

    expect(res.status).toBe(201);
    expect(res.body.asset_model_id).toBe(model.id);
    expect(res.body.installed_on_asset_id).toBe(robot.id);
    expect(res.body.installed_at_hours).toBe(120.5);
    expect(res.body.removed_at_hours).toBeNull();
    expect(res.body.condition_on_removal).toBeNull();
    // No asset row was created for the component itself.
    const assetsRes = await request(app).get('/api/gear/assets');
    expect(assetsRes.body.map(a => a.serial_number)).not.toContain('Carbide Blade v2');
  });

  test('rejects installing onto a non-L3 asset', async () => {
    const beaconType = await createNonMaintainableType('Beacon');
    const bladeType = await createNonMaintainableType('Blade');
    const beacon = await createAsset(beaconType, 'BEACON-010');
    const model = await createModel(bladeType, 'Acme', 'Carbide Blade v3');

    const res = await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id,
      installed_on_asset_id: beacon.id,
      installed_at_hours: 0,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not support maintenance/i);
  });

  test('records condition on removal and rejects removing twice', async () => {
    const robotType = await createMaintainableType('Robot');
    const bladeType = await createNonMaintainableType('Blade');
    const robot = await createAsset(robotType, 'ROBOT-011');
    const model = await createModel(bladeType, 'Acme', 'Carbide Blade v4');
    const installed = await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id,
      installed_on_asset_id: robot.id,
      installed_at_hours: 100,
    });

    const removed = await request(app)
      .patch(`/api/gear/component-installations/${installed.body.id}/remove`)
      .send({ removed_at_hours: 340, condition_on_removal: 'Chipped, replaced' });

    expect(removed.status).toBe(200);
    expect(removed.body.removed_at_hours).toBe(340);
    expect(removed.body.condition_on_removal).toBe('Chipped, replaced');

    const secondRemoval = await request(app)
      .patch(`/api/gear/component-installations/${installed.body.id}/remove`)
      .send({ removed_at_hours: 400 });
    expect(secondRemoval.status).toBe(409);
  });

  test('rejects a removal hour reading earlier than the install reading', async () => {
    const robotType = await createMaintainableType('Robot');
    const bladeType = await createNonMaintainableType('Blade');
    const robot = await createAsset(robotType, 'ROBOT-012');
    const model = await createModel(bladeType, 'Acme', 'Carbide Blade v5');
    const installed = await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id,
      installed_on_asset_id: robot.id,
      installed_at_hours: 200,
    });

    const removed = await request(app)
      .patch(`/api/gear/component-installations/${installed.body.id}/remove`)
      .send({ removed_at_hours: 50 });

    expect(removed.status).toBe(400);
  });

  test('wear can be compared across installations of the same model, across different assets', async () => {
    const robotType = await createMaintainableType('Robot');
    const bladeType = await createNonMaintainableType('Blade');
    const robotA = await createAsset(robotType, 'ROBOT-020');
    const robotB = await createAsset(robotType, 'ROBOT-021');
    const model = await createModel(bladeType, 'Acme', 'Carbide Blade v6');

    const first = await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id, installed_on_asset_id: robotA.id, installed_at_hours: 0,
    });
    await request(app).patch(`/api/gear/component-installations/${first.body.id}/remove`).send({
      removed_at_hours: 300, condition_on_removal: 'Worn evenly',
    });
    await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id, installed_on_asset_id: robotB.id, installed_at_hours: 50,
    });

    const forModel = await request(app).get(`/api/gear/asset-models/${model.id}/component-installations`);

    expect(forModel.status).toBe(200);
    expect(forModel.body).toHaveLength(2);
    expect(forModel.body.map(i => i.installed_on_serial_number).sort()).toEqual(['ROBOT-020', 'ROBOT-021']);
  });

  test("an asset's installation list only shows components it has hosted", async () => {
    const robotType = await createMaintainableType('Robot');
    const bladeType = await createNonMaintainableType('Blade');
    const robotA = await createAsset(robotType, 'ROBOT-030');
    const robotB = await createAsset(robotType, 'ROBOT-031');
    const model = await createModel(bladeType, 'Acme', 'Carbide Blade v7');

    await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id, installed_on_asset_id: robotA.id, installed_at_hours: 0,
    });
    await request(app).post('/api/gear/component-installations').send({
      asset_model_id: model.id, installed_on_asset_id: robotB.id, installed_at_hours: 0,
    });

    const forA = await request(app).get(`/api/gear/assets/${robotA.id}/component-installations`);

    expect(forA.status).toBe(200);
    expect(forA.body).toHaveLength(1);
    expect(forA.body[0].installed_on_asset_id).toBe(robotA.id);
  });
});
