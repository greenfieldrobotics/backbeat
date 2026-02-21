import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory } from './helpers/testHelpers.js';

describe('Parts Catalog', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  // --- Happy Path ---

  test('Create a part with all fields', async () => {
    const res = await request(app).post('/api/parts').send({
      part_number: 'PN-001',
      description: 'Widget A',
      unit_of_measure: 'FT',
      classification: 'Electrical',
      cost: 12.5,
      mfg_part_number: 'MFG-001',
      manufacturer: 'Acme Corp',
      reseller: 'Dist Inc',
      reseller_part_number: 'RSL-001',
      notes: 'Important part',
    });
    expect(res.status).toBe(201);
    expect(res.body.part_number).toBe('PN-001');
    expect(res.body.description).toBe('Widget A');
    expect(res.body.unit_of_measure).toBe('FT');
    expect(res.body.classification).toBe('Electrical');
    expect(res.body.manufacturer).toBe('Acme Corp');
    expect(res.body.id).toBeDefined();
    expect(res.body.created_at).toBeDefined();
  });

  test('List parts sorted by part_number', async () => {
    await createPart({ part_number: 'ZZZ-999' });
    await createPart({ part_number: 'AAA-001' });
    await createPart({ part_number: 'MMM-500' });

    const res = await request(app).get('/api/parts');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0].part_number).toBe('AAA-001');
    expect(res.body[1].part_number).toBe('MMM-500');
    expect(res.body[2].part_number).toBe('ZZZ-999');
  });

  test('Update a part description and classification', async () => {
    const part = await createPart({ part_number: 'UPD-001' });
    const originalUpdatedAt = part.updated_at;

    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 50));

    const res = await request(app).put(`/api/parts/${part.id}`).send({
      description: 'Updated description',
      classification: 'Electrical',
    });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
    expect(res.body.classification).toBe('Electrical');
    expect(new Date(res.body.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });

  test('Delete a part with no inventory', async () => {
    const part = await createPart({ part_number: 'DEL-001' });
    const res = await request(app).delete(`/api/parts/${part.id}`);
    expect(res.status).toBe(204);

    const getRes = await request(app).get(`/api/parts/${part.id}`);
    expect(getRes.status).toBe(404);
  });

  // --- Validation & Edge Cases ---

  test('Missing part_number returns 400', async () => {
    const res = await request(app).post('/api/parts').send({ description: 'No PN' });
    expect(res.status).toBe(400);
  });

  test('Duplicate part_number returns 409', async () => {
    await createPart({ part_number: 'DUP-001' });
    const res = await request(app).post('/api/parts').send({ part_number: 'DUP-001' });
    expect(res.status).toBe(409);
  });

  test('Update to duplicate part_number returns 409', async () => {
    await createPart({ part_number: 'ORIG-A' });
    const partB = await createPart({ part_number: 'ORIG-B' });

    const res = await request(app).put(`/api/parts/${partB.id}`).send({ part_number: 'ORIG-A' });
    expect(res.status).toBe(409);
  });

  test('Delete part with inventory returns 409', async () => {
    const part = await createPart({ part_number: 'INV-PART' });
    const location = await createLocation();
    const supplier = await createSupplier();
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10 });

    const res = await request(app).delete(`/api/parts/${part.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/inventory/i);
  });

  test('Get non-existent part returns 404', async () => {
    const res = await request(app).get('/api/parts/99999');
    expect(res.status).toBe(404);
  });

  test('Update non-existent part returns 404', async () => {
    const res = await request(app).put('/api/parts/99999').send({ description: 'Nope' });
    expect(res.status).toBe(404);
  });

  test('Update with no fields returns 400', async () => {
    const part = await createPart({ part_number: 'EMPTY-UPD' });
    const res = await request(app).put(`/api/parts/${part.id}`).send({});
    expect(res.status).toBe(400);
  });

  test('Default values when only part_number is provided', async () => {
    const res = await request(app).post('/api/parts').send({ part_number: 'DEFAULTS-001' });
    expect(res.status).toBe(201);
    expect(res.body.unit_of_measure).toBe('EA');
    expect(res.body.classification).toBe('General');
    expect(res.body.description).toBe('');
  });

  // --- Search & Filter ---

  test('Search by part_number', async () => {
    await createPart({ part_number: 'BOLT-100' });
    await createPart({ part_number: 'BOLT-200' });
    await createPart({ part_number: 'NUT-300' });

    const res = await request(app).get('/api/parts?search=BOLT');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every(p => p.part_number.includes('BOLT'))).toBe(true);
  });

  test('Search by description (case-insensitive)', async () => {
    await createPart({ part_number: 'DESC-1', description: 'Hydraulic pump' });
    await createPart({ part_number: 'DESC-2', description: 'Electric motor' });

    const res = await request(app).get('/api/parts?search=hydraulic');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].part_number).toBe('DESC-1');
  });

  test('Search by manufacturer', async () => {
    await createPart({ part_number: 'MFG-1', manufacturer: 'Acme Corp' });
    await createPart({ part_number: 'MFG-2', manufacturer: 'Beta Inc' });

    const res = await request(app).get('/api/parts?search=Acme');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].part_number).toBe('MFG-1');
  });

  test('Filter by classification', async () => {
    await createPart({ part_number: 'CLS-1', classification: 'Electrical' });
    await createPart({ part_number: 'CLS-2', classification: 'Mechanical' });
    await createPart({ part_number: 'CLS-3', classification: 'Electrical' });

    const res = await request(app).get('/api/parts?classification=Electrical');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every(p => p.classification === 'Electrical')).toBe(true);
  });

  test('Combined search + classification filter', async () => {
    await createPart({ part_number: 'COMBO-1', classification: 'Electrical', description: 'Motor' });
    await createPart({ part_number: 'COMBO-2', classification: 'Mechanical', description: 'Motor' });
    await createPart({ part_number: 'COMBO-3', classification: 'Electrical', description: 'Pump' });

    const res = await request(app).get('/api/parts?search=Motor&classification=Electrical');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].part_number).toBe('COMBO-1');
  });
});
