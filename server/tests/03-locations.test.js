import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createLocation, createPart, createSupplier, receiveInventory } from './helpers/testHelpers.js';

describe('Locations', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  // --- Happy Path ---

  test('Create location of each type', async () => {
    const types = ['Warehouse', 'Regional Site', 'Contract Manufacturer'];
    for (const type of types) {
      const res = await request(app).post('/api/locations').send({ name: `Test ${type}`, type });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
      expect(res.body.id).toBeDefined();
    }
  });

  test('List locations sorted by name', async () => {
    await createLocation({ name: 'Zulu Warehouse', type: 'Warehouse' });
    await createLocation({ name: 'Alpha Site', type: 'Regional Site' });
    await createLocation({ name: 'Mike CM', type: 'Contract Manufacturer' });

    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0].name).toBe('Alpha Site');
    expect(res.body[1].name).toBe('Mike CM');
    expect(res.body[2].name).toBe('Zulu Warehouse');
  });

  test('Update location name and type', async () => {
    const loc = await createLocation({ name: 'Old Name', type: 'Warehouse' });
    const res = await request(app).put(`/api/locations/${loc.id}`).send({
      name: 'New Name',
      type: 'Regional Site',
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.type).toBe('Regional Site');
  });

  test('Delete location with no inventory', async () => {
    const loc = await createLocation({ name: 'Delete Me', type: 'Warehouse' });
    const res = await request(app).delete(`/api/locations/${loc.id}`);
    expect(res.status).toBe(204);
  });

  // --- Validation & Edge Cases ---

  test('Missing name or type returns 400', async () => {
    const res1 = await request(app).post('/api/locations').send({ type: 'Warehouse' });
    expect(res1.status).toBe(400);

    const res2 = await request(app).post('/api/locations').send({ name: 'No Type' });
    expect(res2.status).toBe(400);
  });

  test('Invalid type returns 400', async () => {
    const res = await request(app).post('/api/locations').send({ name: 'Bad Type', type: 'Office' });
    expect(res.status).toBe(400);
  });

  test('Duplicate name returns 409', async () => {
    await createLocation({ name: 'Unique Loc', type: 'Warehouse' });
    const res = await request(app).post('/api/locations').send({ name: 'Unique Loc', type: 'Regional Site' });
    expect(res.status).toBe(409);
  });

  test('Delete location with inventory returns 409', async () => {
    const location = await createLocation({ name: 'Has Inventory', type: 'Warehouse' });
    const part = await createPart({ part_number: 'LOC-DEL-PART' });
    const supplier = await createSupplier();
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10 });

    const res = await request(app).delete(`/api/locations/${location.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/inventory/i);
  });

  test('Update to duplicate name returns 409', async () => {
    await createLocation({ name: 'Name A', type: 'Warehouse' });
    const locB = await createLocation({ name: 'Name B', type: 'Warehouse' });

    const res = await request(app).put(`/api/locations/${locB.id}`).send({ name: 'Name A' });
    expect(res.status).toBe(409);
  });

  test('Update with invalid type returns 400', async () => {
    const loc = await createLocation({ name: 'Valid Loc', type: 'Warehouse' });
    const res = await request(app).put(`/api/locations/${loc.id}`).send({ type: 'Office' });
    expect(res.status).toBe(400);
  });
});
