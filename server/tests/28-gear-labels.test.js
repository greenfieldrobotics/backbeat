// Phase 7 — label generation (G2.4, local prototype scope). Covers:
//   - GET /api/gear/labels/:assetId (single label, default vs explicit symbology)
//   - GET /api/gear/labels?ids=... (batch, for a print sheet)
//   - GET/PUT /api/gear/asset-types/:id/label-setting (per-type default, data-driven)
// Printing to real equipment, DNS/redirect work and a ZPL proxy are all out of scope
// (handoff/phase-7-prompt.md) — this only covers local generation.
import { truncateAllTables } from './setup/testSetup.js';
import { request, app } from './helpers/testHelpers.js';
import { initializeDatabase } from '../src/db/schema.js';
import pool from '../src/db/connection.js';

async function lifecycleStateId(name) {
  const res = await request(app).get('/api/gear/lifecycle-states');
  return res.body.find(s => s.name === name).id;
}

async function createType(name) {
  const res = await request(app).post('/api/gear/asset-types').send({ name });
  return res.body;
}

async function createAsset({ serial_number, asset_type_id, lifecycle_state_id }) {
  const res = await request(app).post('/api/gear/assets').send({
    serial_number, asset_type_id, lifecycle_state_id,
  });
  return res.body;
}

describe('Gear — Label generation (Phase 7)', () => {
  let availableId;

  beforeEach(async () => {
    await truncateAllTables();
    await initializeDatabase(pool); // reseeds lifecycle_states + the Greenfield party
    availableId = await lifecycleStateId('Available');
  });

  describe('GET /api/gear/labels/:assetId', () => {
    test('generates a QR label using the type default when none is configured', async () => {
      const type = await createType('Robot');
      const asset = await createAsset({ serial_number: 'GFR-7001', asset_type_id: type.id, lifecycle_state_id: availableId });

      const res = await request(app).get(`/api/gear/labels/${asset.id}`);
      expect(res.status).toBe(200);
      expect(res.body.asset_id).toBe(asset.id);
      expect(res.body.serial_number).toBe('GFR-7001');
      expect(res.body.symbology).toBe('qr'); // unconfigured type falls back to qr
      expect(res.body.url).toBe('http://localhost:5173/a/GFR-7001');
      expect(res.body.svg).toMatch(/^<svg /);
      expect(res.body.svg).not.toMatch(/text/); // no baked-in human-readable text node
      // Explicit physical size (mm), not left for the browser to guess (see "three
      // things that will bite" #3) — bwip-js's own SVG has no width/height, only a
      // viewBox, which some browsers render at zero size.
      expect(res.body.svg).toMatch(/width="[0-9.]+mm" height="[0-9.]+mm"/);
    });

    test('follows the configured per-type default (datamatrix), without a hardcoded switch', async () => {
      const type = await createType('VCU');
      await request(app).put(`/api/gear/asset-types/${type.id}/label-setting`).send({ default_symbology: 'datamatrix' });
      const asset = await createAsset({ serial_number: 'GFR-7002', asset_type_id: type.id, lifecycle_state_id: availableId });

      const res = await request(app).get(`/api/gear/labels/${asset.id}`);
      expect(res.status).toBe(200);
      expect(res.body.symbology).toBe('datamatrix');
    });

    test('an explicit ?symbology overrides the type default (battery: QR or DataMatrix)', async () => {
      const type = await createType('Battery');
      await request(app).put(`/api/gear/asset-types/${type.id}/label-setting`).send({ default_symbology: 'qr' });
      const asset = await createAsset({ serial_number: 'GFR-7003', asset_type_id: type.id, lifecycle_state_id: availableId });

      const res = await request(app).get(`/api/gear/labels/${asset.id}?symbology=datamatrix`);
      expect(res.status).toBe(200);
      expect(res.body.symbology).toBe('datamatrix');
    });

    test('an invalid ?symbology 400s with a clear message', async () => {
      const type = await createType('Robot');
      const asset = await createAsset({ serial_number: 'GFR-7004', asset_type_id: type.id, lifecycle_state_id: availableId });

      const res = await request(app).get(`/api/gear/labels/${asset.id}?symbology=code128`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/symbology/);
    });

    test('an asset with no serial number 400s — there is nothing to encode', async () => {
      const type = await createType('Robot');
      const asset = await createAsset({ serial_number: '', asset_type_id: type.id, lifecycle_state_id: availableId });

      const res = await request(app).get(`/api/gear/labels/${asset.id}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/serial/i);
    });

    test('an unknown asset id 404s', async () => {
      const res = await request(app).get('/api/gear/labels/999999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/gear/labels (batch, print sheet)', () => {
    test('generates a mixed sheet and reports per-asset failures without failing the batch', async () => {
      const robot = await createType('Robot');
      await request(app).put(`/api/gear/asset-types/${robot.id}/label-setting`).send({ default_symbology: 'qr' });
      const vcu = await createType('VCU');
      await request(app).put(`/api/gear/asset-types/${vcu.id}/label-setting`).send({ default_symbology: 'datamatrix' });

      const a1 = await createAsset({ serial_number: 'GFR-7010', asset_type_id: robot.id, lifecycle_state_id: availableId });
      const a2 = await createAsset({ serial_number: 'GFR-7011', asset_type_id: vcu.id, lifecycle_state_id: availableId });
      const a3 = await createAsset({ serial_number: '', asset_type_id: robot.id, lifecycle_state_id: availableId }); // no serial

      const res = await request(app).get(`/api/gear/labels?ids=${a1.id},${a2.id},${a3.id},999999`);
      expect(res.status).toBe(200);
      expect(res.body.labels).toHaveLength(2);
      expect(res.body.labels.find(l => l.asset_id === a1.id).symbology).toBe('qr');
      expect(res.body.labels.find(l => l.asset_id === a2.id).symbology).toBe('datamatrix');
      expect(res.body.errors).toHaveLength(2);
      expect(res.body.errors.map(e => e.asset_id).sort()).toEqual([a3.id, 999999].sort());
    });

    test('missing ids query parameter 400s', async () => {
      const res = await request(app).get('/api/gear/labels');
      expect(res.status).toBe(400);
    });

    test('a forced ?symbology applies to every asset in the sheet', async () => {
      const robot = await createType('Robot');
      const a1 = await createAsset({ serial_number: 'GFR-7020', asset_type_id: robot.id, lifecycle_state_id: availableId });

      const res = await request(app).get(`/api/gear/labels?ids=${a1.id}&symbology=datamatrix`);
      expect(res.status).toBe(200);
      expect(res.body.labels[0].symbology).toBe('datamatrix');
    });
  });

  describe('GET/PUT /api/gear/asset-types/:id/label-setting', () => {
    test('defaults to qr for a type with no configured setting', async () => {
      const type = await createType('Trailer');
      const res = await request(app).get(`/api/gear/asset-types/${type.id}/label-setting`);
      expect(res.status).toBe(200);
      expect(res.body.default_symbology).toBe('qr');
    });

    test('PUT sets and persists the default, GET reflects it', async () => {
      const type = await createType('Small Electronics');
      const put = await request(app).put(`/api/gear/asset-types/${type.id}/label-setting`).send({ default_symbology: 'datamatrix' });
      expect(put.status).toBe(200);
      expect(put.body.default_symbology).toBe('datamatrix');

      const get = await request(app).get(`/api/gear/asset-types/${type.id}/label-setting`);
      expect(get.body.default_symbology).toBe('datamatrix');
    });

    test('an invalid symbology value 400s', async () => {
      const type = await createType('Bin');
      const res = await request(app).put(`/api/gear/asset-types/${type.id}/label-setting`).send({ default_symbology: 'pdf417' });
      expect(res.status).toBe(400);
    });

    test('an unknown asset type id 404s on both GET and PUT', async () => {
      const get = await request(app).get('/api/gear/asset-types/999999/label-setting');
      expect(get.status).toBe(404);
      const put = await request(app).put('/api/gear/asset-types/999999/label-setting').send({ default_symbology: 'qr' });
      expect(put.status).toBe(404);
    });
  });
});
