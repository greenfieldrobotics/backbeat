import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createAsset, createLocation } from './helpers/testHelpers.js';

describe('Gear — Assets', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  // --- Happy Path ---

  test('Create an asset with serial and asset type', async () => {
    const res = await request(app).post('/api/gear/assets').send({
      asset_tag: 'ROBOT-001',
      serial_number: 'SN-ABC-123',
      asset_type: 'Robot',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.asset_tag).toBe('ROBOT-001');
    expect(res.body.serial_number).toBe('SN-ABC-123');
    expect(res.body.asset_type).toBe('Robot');
    expect(res.body.status).toBe('Available'); // default
  });

  test('List assets sorted by asset_tag, with location name joined', async () => {
    const loc = await createLocation({ name: 'Robot Bay', type: 'Warehouse' });
    await createAsset({ asset_tag: 'ZZZ-9', asset_type: 'Tool' });
    await createAsset({ asset_tag: 'AAA-1', asset_type: 'Robot', location_id: loc.id });

    const res = await request(app).get('/api/gear/assets');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].asset_tag).toBe('AAA-1');
    expect(res.body[0].location_name).toBe('Robot Bay'); // cross-module join to shared locations
    expect(res.body[1].asset_tag).toBe('ZZZ-9');
    expect(res.body[1].location_name).toBeNull();
  });

  test('Get a single asset by id', async () => {
    const asset = await createAsset({ asset_tag: 'GET-1' });
    const res = await request(app).get(`/api/gear/assets/${asset.id}`);
    expect(res.status).toBe(200);
    expect(res.body.asset_tag).toBe('GET-1');
  });

  test('Update an asset status and location', async () => {
    const loc = await createLocation({ name: 'Maintenance Shop', type: 'Warehouse' });
    const asset = await createAsset({ asset_tag: 'UPD-1' });
    const res = await request(app).put(`/api/gear/assets/${asset.id}`).send({
      status: 'Maintenance',
      location_id: loc.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Maintenance');
    expect(res.body.location_id).toBe(loc.id);
  });

  test('Delete an asset', async () => {
    const asset = await createAsset({ asset_tag: 'DEL-1' });
    const res = await request(app).delete(`/api/gear/assets/${asset.id}`);
    expect(res.status).toBe(204);
    const check = await request(app).get(`/api/gear/assets/${asset.id}`);
    expect(check.status).toBe(404);
  });

  // --- Validation / Errors ---

  test('Missing asset_tag returns 400', async () => {
    const res = await request(app).post('/api/gear/assets').send({ asset_type: 'Robot' });
    expect(res.status).toBe(400);
  });

  test('Duplicate asset_tag returns 409', async () => {
    await createAsset({ asset_tag: 'DUP-1' });
    const res = await request(app).post('/api/gear/assets').send({ asset_tag: 'DUP-1' });
    expect(res.status).toBe(409);
  });

  test('Invalid status returns 400', async () => {
    const res = await request(app).post('/api/gear/assets').send({ asset_tag: 'BAD-STATUS', status: 'Nonsense' });
    expect(res.status).toBe(400);
  });

  test('Create with non-existent location returns 404', async () => {
    const res = await request(app).post('/api/gear/assets').send({ asset_tag: 'NO-LOC', location_id: 999999 });
    expect(res.status).toBe(404);
  });

  test('Get non-existent asset returns 404', async () => {
    const res = await request(app).get('/api/gear/assets/999999');
    expect(res.status).toBe(404);
  });
});
