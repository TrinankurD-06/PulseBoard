import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const app = buildTestApp();

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe('GET /health', () => {
  it('reports ok when MongoDB is connected', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', mongo: 'connected' });
  });
});

describe('app-level behaviour', () => {
  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /api/v1/does-not-exist not found' },
    });
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await request(app)
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects bodies over the size limit', async () => {
    const res = await request(app)
      .post('/api/v1/anything')
      .send({ big: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('sets security headers and a request id', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for the configured client origin', async () => {
    const allowed = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
