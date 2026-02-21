import request from 'supertest';
import app from '../src/app.js';

describe('Health Check', () => {
  test('GET /api/health returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      module: 'Stash',
      version: '0.1.0',
    });
  });
});
