import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createSupplier } from './helpers/testHelpers.js';

describe('Suppliers', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  test('Create a supplier', async () => {
    const res = await request(app).post('/api/suppliers').send({ name: 'Acme Corp' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Acme Corp');
    expect(res.body.id).toBeDefined();
    expect(res.body.created_at).toBeDefined();
  });

  test('List suppliers sorted by name', async () => {
    await createSupplier({ name: 'Zulu Supply' });
    await createSupplier({ name: 'Alpha Parts' });

    const res = await request(app).get('/api/suppliers');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].name).toBe('Alpha Parts');
    expect(res.body[1].name).toBe('Zulu Supply');
  });

  test('Missing name returns 400', async () => {
    const res = await request(app).post('/api/suppliers').send({});
    expect(res.status).toBe(400);
  });

  test('Duplicate name returns 409', async () => {
    await createSupplier({ name: 'Unique Supplier' });
    const res = await request(app).post('/api/suppliers').send({ name: 'Unique Supplier' });
    expect(res.status).toBe(409);
  });
});
