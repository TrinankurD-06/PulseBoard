import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDemoTargetApp } from '../src/app.js';

describe('demo target', () => {
  it('starts healthy', async () => {
    const res = await request(createDemoTargetApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('healthy');
  });

  it('switches modes via the admin API', async () => {
    const app = createDemoTargetApp();
    await request(app).post('/admin/mode').send({ mode: 'error500' }).expect(200);
    expect((await request(app).get('/')).status).toBe(500);

    await request(app).post('/admin/mode').send({ mode: 'missing-keyword' });
    const degraded = await request(app).get('/');
    expect(degraded.status).toBe(200);
    expect(degraded.text).not.toContain('healthy');

    expect((await request(app).get('/admin/mode')).body.mode).toBe('missing-keyword');
  });

  it('drops the connection in down mode', async () => {
    const app = createDemoTargetApp({ initialMode: 'down' });
    await expect(request(app).get('/')).rejects.toThrow(/socket hang up|ECONNRESET/);
  });

  it('rejects unknown modes', async () => {
    const res = await request(createDemoTargetApp()).post('/admin/mode').send({ mode: 'chaos' });
    expect(res.status).toBe(400);
  });

  it('serves the control page', async () => {
    const res = await request(createDemoTargetApp()).get('/admin');
    expect(res.text).toContain('data-mode="down"');
  });
});
