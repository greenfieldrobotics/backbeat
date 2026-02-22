import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/db/connection.js';

describe('Authentication', () => {
  describe('Users table', () => {
    test('users table exists and accepts inserts', async () => {
      const { rows } = await query(
        "INSERT INTO users (email, name, role) VALUES ('test@example.com', 'Test User', 'viewer') RETURNING id, email, name, role"
      );
      expect(rows[0]).toMatchObject({
        email: 'test@example.com',
        name: 'Test User',
        role: 'viewer',
      });
      // Cleanup
      await query('DELETE FROM users WHERE email = $1', ['test@example.com']);
    });

    test('email must be unique', async () => {
      await query("INSERT INTO users (email, name) VALUES ('dup@example.com', 'User 1')");
      await expect(
        query("INSERT INTO users (email, name) VALUES ('dup@example.com', 'User 2')")
      ).rejects.toThrow();
      await query("DELETE FROM users WHERE email = 'dup@example.com'");
    });

    test('role must be admin, warehouse, procurement, or viewer', async () => {
      await expect(
        query("INSERT INTO users (email, name, role) VALUES ('bad@example.com', 'Bad', 'superadmin')")
      ).rejects.toThrow();
    });

    test('accepts all valid roles', async () => {
      for (const role of ['admin', 'warehouse', 'procurement', 'viewer']) {
        const email = `role-${role}@example.com`;
        const { rows } = await query(
          `INSERT INTO users (email, name, role) VALUES ($1, 'Role Test', $2) RETURNING role`,
          [email, role]
        );
        expect(rows[0].role).toBe(role);
        await query('DELETE FROM users WHERE email = $1', [email]);
      }
    });
  });

  describe('Auth endpoints', () => {
    test('GET /auth/me returns 401 without session (when Google is configured)', async () => {
      // Save and set env
      const origClientId = process.env.GOOGLE_CLIENT_ID;
      process.env.GOOGLE_CLIENT_ID = 'fake-id';

      try {
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Not authenticated');
      } finally {
        if (origClientId === undefined) {
          delete process.env.GOOGLE_CLIENT_ID;
        } else {
          process.env.GOOGLE_CLIENT_ID = origClientId;
        }
      }
    });

    test('GET /auth/me returns dev user when Google is not configured', async () => {
      // Ensure GOOGLE_CLIENT_ID is not set
      const origClientId = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;

      try {
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          id: 0,
          email: 'dev@localhost',
          name: 'Dev User',
        });
      } finally {
        if (origClientId !== undefined) {
          process.env.GOOGLE_CLIENT_ID = origClientId;
        }
      }
    });

    test('GET /auth/google returns 501 when Google is not configured', async () => {
      const origClientId = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;

      try {
        const res = await request(app).get('/auth/google');
        expect(res.status).toBe(501);
      } finally {
        if (origClientId !== undefined) {
          process.env.GOOGLE_CLIENT_ID = origClientId;
        }
      }
    });

    test('POST /auth/logout succeeds', async () => {
      const res = await request(app).post('/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('Auth middleware (NODE_ENV=test bypass)', () => {
    test('API routes are accessible when NODE_ENV=test', async () => {
      // NODE_ENV is already 'test' because we're running via npm test
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    test('API routes are accessible when NODE_ENV=test (parts endpoint)', async () => {
      const res = await request(app).get('/api/parts');
      expect(res.status).toBe(200);
    });
  });
});
