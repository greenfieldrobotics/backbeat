// Phase 9 — asset_links (G5.1 time-bounded links, G5.2 two-scan linking, §6.2's
// no-EXCLUDE-constraint rule).
import { truncateAllTables } from './setup/testSetup.js';
import { request, app } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool, { query } from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

async function createLinkableType(name) {
  const res = await request(app).post('/api/gear/asset-types').send({ name, supports_linking: true });
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

describe('Gear — Asset links (Phase 9)', () => {
  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
  });

  test('opens a link recording the parent, the child, and when', async () => {
    const robotType = await createLinkableType('Robot');
    const batteryType = await createLinkableType('Battery');
    const robot = await createAsset(robotType, 'ROBOT-001');
    const battery = await createAsset(batteryType, 'BATT-001');

    const res = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robot.id,
      child_asset_id: battery.id,
      link_type: 'installed_in',
    });

    expect(res.status).toBe(201);
    expect(res.body.parent_asset_id).toBe(robot.id);
    expect(res.body.child_asset_id).toBe(battery.id);
    expect(res.body.link_type).toBe('installed_in');
    expect(res.body.valid_from).toBeTruthy();
    expect(res.body.valid_to).toBeNull();
    expect(res.body.parent_serial_number).toBe('ROBOT-001');
    expect(res.body.child_serial_number).toBe('BATT-001');
  });

  test('one link_type value set covers battery-in-robot and robot-on-trailer with no schema change', async () => {
    const robotType = await createLinkableType('Robot');
    const trailerType = await createLinkableType('Trailer');
    const batteryType = await createLinkableType('Battery');
    const robot = await createAsset(robotType, 'ROBOT-010');
    const trailer = await createAsset(trailerType, 'TRAILER-010');
    const battery = await createAsset(batteryType, 'BATT-010');

    const batteryLink = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robot.id, child_asset_id: battery.id, link_type: 'installed_in',
    });
    const robotLink = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: trailer.id, child_asset_id: robot.id, link_type: 'mounted_on',
    });

    expect(batteryLink.status).toBe(201);
    expect(robotLink.status).toBe(201);
  });

  test('a second open link for the same child is rejected with a clear 409', async () => {
    const robotType = await createLinkableType('Robot');
    const batteryType = await createLinkableType('Battery');
    const robotA = await createAsset(robotType, 'ROBOT-A');
    const robotB = await createAsset(robotType, 'ROBOT-B');
    const battery = await createAsset(batteryType, 'BATT-002');

    const first = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robotA.id, child_asset_id: battery.id, link_type: 'installed_in',
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robotB.id, child_asset_id: battery.id, link_type: 'installed_in',
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already has an open link/i);
  });

  test('the partial unique index rejects a second open row even if the service check is bypassed', async () => {
    const robotType = await createLinkableType('Robot');
    const batteryType = await createLinkableType('Battery');
    const robotA = await createAsset(robotType, 'ROBOT-C');
    const robotB = await createAsset(robotType, 'ROBOT-D');
    const battery = await createAsset(batteryType, 'BATT-003');

    await query(
      `INSERT INTO asset_links (parent_asset_id, child_asset_id, link_type, valid_from) VALUES ($1, $2, 'installed_in', NOW())`,
      [robotA.id, battery.id]
    );

    await expect(
      query(
        `INSERT INTO asset_links (parent_asset_id, child_asset_id, link_type, valid_from) VALUES ($1, $2, 'installed_in', NOW())`,
        [robotB.id, battery.id]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  test('closing a link and opening a new one leaves both rows intact and queryable', async () => {
    const robotType = await createLinkableType('Robot');
    const batteryType = await createLinkableType('Battery');
    const robotA = await createAsset(robotType, 'ROBOT-E');
    const robotB = await createAsset(robotType, 'ROBOT-F');
    const battery = await createAsset(batteryType, 'BATT-004');

    const opened = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robotA.id, child_asset_id: battery.id, link_type: 'installed_in',
    });
    expect(opened.status).toBe(201);

    const closed = await request(app).patch(`/api/gear/asset-links/${opened.body.id}/close`).send({});
    expect(closed.status).toBe(200);
    expect(closed.body.valid_to).toBeTruthy();

    const reopened = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robotB.id, child_asset_id: battery.id, link_type: 'installed_in',
    });
    expect(reopened.status).toBe(201);

    const history = await request(app).get(`/api/gear/assets/${battery.id}/links`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    const ids = history.body.map(l => l.id);
    expect(ids).toEqual(expect.arrayContaining([opened.body.id, reopened.body.id]));
  });

  test('closing an already-closed link 409s', async () => {
    const robotType = await createLinkableType('Robot');
    const batteryType = await createLinkableType('Battery');
    const robot = await createAsset(robotType, 'ROBOT-G');
    const battery = await createAsset(batteryType, 'BATT-005');

    const opened = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robot.id, child_asset_id: battery.id, link_type: 'installed_in',
    });
    await request(app).patch(`/api/gear/asset-links/${opened.body.id}/close`).send({});

    const secondClose = await request(app).patch(`/api/gear/asset-links/${opened.body.id}/close`).send({});
    expect(secondClose.status).toBe(409);
  });

  test('reads back which parent a child was attached to on a date after that link closed (G5.1)', async () => {
    const robotType = await createLinkableType('Robot');
    const vcuType = await createLinkableType('VCU');
    const robotA = await createAsset(robotType, 'ROBOT-H');
    const robotB = await createAsset(robotType, 'ROBOT-I');
    const vcu = await createAsset(vcuType, 'VCU-001');

    const t1 = new Date('2026-01-01T00:00:00Z').toISOString();
    const t2 = new Date('2026-03-01T00:00:00Z').toISOString();

    const linkA = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robotA.id, child_asset_id: vcu.id, link_type: 'installed_in', valid_from: t1,
    });
    await query('UPDATE asset_links SET valid_to = $1 WHERE id = $2', [t2, linkA.body.id]);

    const linkB = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robotB.id, child_asset_id: vcu.id, link_type: 'installed_in', valid_from: t2,
    });

    const midJanuary = await request(app).get(`/api/gear/assets/${vcu.id}/links?as_of=2026-01-15T00:00:00Z`);
    expect(midJanuary.status).toBe(200);
    expect(midJanuary.body).toHaveLength(1);
    expect(midJanuary.body[0].id).toBe(linkA.body.id);
    expect(midJanuary.body[0].parent_asset_id).toBe(robotA.id);

    const april = await request(app).get(`/api/gear/assets/${vcu.id}/links?as_of=2026-04-01T00:00:00Z`);
    expect(april.status).toBe(200);
    expect(april.body).toHaveLength(1);
    expect(april.body[0].id).toBe(linkB.body.id);
    expect(april.body[0].parent_asset_id).toBe(robotB.id);
  });

  test('capability check: an asset type without supports_linking cannot be linked (§2.3)', async () => {
    const robotType = await createLinkableType('Robot');
    const unlinkedTypeRes = await request(app).post('/api/gear/asset-types').send({ name: 'Shelf' }); // supports_linking defaults false
    const robot = await createAsset(robotType, 'ROBOT-J');
    const shelf = await createAsset(unlinkedTypeRes.body.id, 'SHELF-001');

    const res = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robot.id, child_asset_id: shelf.id, link_type: 'installed_in',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not support linking/i);
  });

  test('capability check applies to the parent side too', async () => {
    const unlinkedTypeRes = await request(app).post('/api/gear/asset-types').send({ name: 'Shelf' });
    const batteryType = await createLinkableType('Battery');
    const shelf = await createAsset(unlinkedTypeRes.body.id, 'SHELF-002');
    const battery = await createAsset(batteryType, 'BATT-006');

    const res = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: shelf.id, child_asset_id: battery.id, link_type: 'installed_in',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not support linking/i);
  });

  test('an asset cannot be linked to itself', async () => {
    const robotType = await createLinkableType('Robot');
    const robot = await createAsset(robotType, 'ROBOT-K');

    const res = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robot.id, child_asset_id: robot.id, link_type: 'installed_in',
    });

    expect(res.status).toBe(400);
  });

  test('a nonexistent parent or child 404s', async () => {
    const batteryType = await createLinkableType('Battery');
    const battery = await createAsset(batteryType, 'BATT-007');

    const noParent = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: 999999, child_asset_id: battery.id, link_type: 'installed_in',
    });
    expect(noParent.status).toBe(404);

    const robotType = await createLinkableType('Robot');
    const robot = await createAsset(robotType, 'ROBOT-L');
    const noChild = await request(app).post('/api/gear/asset-links').send({
      parent_asset_id: robot.id, child_asset_id: 999999, link_type: 'installed_in',
    });
    expect(noChild.status).toBe(404);
  });

  test('there is no asset-to-asset foreign key outside asset_links (no vcu_id-style column on assets)', async () => {
    const { rows } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'assets' AND column_name LIKE '%asset_id%'
    `);
    expect(rows).toHaveLength(0);
  });
});
