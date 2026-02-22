import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/db/connection.js';

describe('User Management API', () => {
  // Clean up test users after each test
  afterEach(async () => {
    await query("DELETE FROM users WHERE email LIKE '%@test-users.example.com'");
  });

  test('list users returns all users', async () => {
    // Seed two test users
    await query(
      "INSERT INTO users (email, name, role) VALUES ('alice@test-users.example.com', 'Alice', 'admin')"
    );
    await query(
      "INSERT INTO users (email, name, role) VALUES ('bob@test-users.example.com', 'Bob', 'viewer')"
    );

    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const emails = res.body.map(u => u.email);
    expect(emails).toContain('alice@test-users.example.com');
    expect(emails).toContain('bob@test-users.example.com');
  });

  test('create user with valid email/name/role', async () => {
    const res = await request(app).post('/api/users').send({
      email: 'new@test-users.example.com',
      name: 'New User',
      role: 'warehouse',
    });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('new@test-users.example.com');
    expect(res.body.name).toBe('New User');
    expect(res.body.role).toBe('warehouse');
    expect(res.body.id).toBeDefined();
  });

  test('create user with duplicate email returns 409', async () => {
    await request(app).post('/api/users').send({
      email: 'dup@test-users.example.com',
      name: 'First',
      role: 'viewer',
    });

    const res = await request(app).post('/api/users').send({
      email: 'dup@test-users.example.com',
      name: 'Second',
      role: 'viewer',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  test('create user with invalid role returns 400', async () => {
    const res = await request(app).post('/api/users').send({
      email: 'badrole@test-users.example.com',
      name: 'Bad Role',
      role: 'superadmin',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid role/);
  });

  test('create user with missing email returns 400', async () => {
    const res = await request(app).post('/api/users').send({
      name: 'No Email',
      role: 'viewer',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Email is required/);
  });

  test('update user role', async () => {
    const createRes = await request(app).post('/api/users').send({
      email: 'update@test-users.example.com',
      name: 'To Update',
      role: 'viewer',
    });
    const userId = createRes.body.id;

    const res = await request(app).put(`/api/users/${userId}`).send({ role: 'procurement' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('procurement');
  });

  test('update non-existent user returns 404', async () => {
    const res = await request(app).put('/api/users/999999').send({ role: 'admin' });
    expect(res.status).toBe(404);
  });

  test('delete user', async () => {
    const createRes = await request(app).post('/api/users').send({
      email: 'todelete@test-users.example.com',
      name: 'Delete Me',
      role: 'viewer',
    });
    const userId = createRes.body.id;

    const res = await request(app).delete(`/api/users/${userId}`);
    expect(res.status).toBe(204);

    // Verify deleted
    const listRes = await request(app).get('/api/users');
    const emails = listRes.body.map(u => u.email);
    expect(emails).not.toContain('todelete@test-users.example.com');
  });

  test('delete non-existent user returns 404', async () => {
    const res = await request(app).delete('/api/users/999999');
    expect(res.status).toBe(404);
  });

  test('create user defaults to viewer role', async () => {
    const res = await request(app).post('/api/users').send({
      email: 'default@test-users.example.com',
      name: 'Default Role',
    });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('viewer');
  });
});
