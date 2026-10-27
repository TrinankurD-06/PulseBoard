import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentController } from '../src/agentController.js';
import { createDemoTargetApp } from '../src/app.js';

/** A controller whose "agent" records the requests it sees instead of reporting. */
function fakeAgent() {
  const seen = [];
  const instances = [];
  const createAgent = () => {
    const instance = (req, res, next) => {
      res.once('finish', () => seen.push({ route: req.route?.path, status: res.statusCode }));
      next();
    };
    instance.stop = vi.fn(async () => {});
    instances.push(instance);
    return instance;
  };
  const config = { apiKey: 'pbk_test', endpoint: 'http://pb.test/api/v1', reportEverySec: 30 };
  const agent = createAgentController({ config, createAgent, logger: { warn() {} } });
  return { agent, seen, instances };
}

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

  it('drops the connection in down mode, on every site route', async () => {
    const app = createDemoTargetApp({ initialMode: 'down' });
    await expect(request(app).get('/')).rejects.toThrow(/socket hang up|ECONNRESET/);
    await expect(request(app).head('/')).rejects.toThrow(/socket hang up|ECONNRESET/);
    await expect(request(app).get('/api/products')).rejects.toThrow(/socket hang up|ECONNRESET/);
  });

  it('rejects unknown modes and scenarios', async () => {
    const app = createDemoTargetApp();
    expect((await request(app).post('/admin/mode').send({ mode: 'chaos' })).status).toBe(400);
    expect((await request(app).post('/admin/scenario').send({ scenario: 'x' })).status).toBe(400);
  });

  it('serves the control page with modes and agent scenarios', async () => {
    const res = await request(createDemoTargetApp()).get('/admin');
    expect(res.text).toContain('data-mode="down"');
    for (const scenario of ['crash', 'agent-silent', 'errors', 'restore']) {
      expect(res.text).toContain(`data-scenario="${scenario}"`);
    }
  });

  it('serves the API routes, with 404 for unknown orders', async () => {
    const app = createDemoTargetApp();
    expect((await request(app).get('/api/products')).body).toHaveLength(3);
    expect((await request(app).get('/api/orders/1234')).body).toMatchObject({ id: 1234 });
    expect((await request(app).get('/api/orders/unknown')).status).toBe(404);
  });

  it('runs without an agent when no key is configured', async () => {
    const res = await request(createDemoTargetApp()).get('/admin/state');
    expect(res.body.agent.state).toBe('off');
    expect(res.body.traffic).toBeNull();
  });
});

describe('demo target with the app agent', () => {
  it('measures site routes (with their patterns) but not the control page', async () => {
    const { agent, seen } = fakeAgent();
    const app = createDemoTargetApp({ agent });
    await request(app).get('/api/orders/42');
    await request(app).get('/admin/state');
    await request(app).get('/');
    expect(seen).toEqual([
      { route: '/api/orders/:id', status: 200 },
      { route: '/', status: 200 },
    ]);
  });

  it('5xx errors scenario: failures are visible to the agent per route', async () => {
    const { agent, seen } = fakeAgent();
    const app = createDemoTargetApp({ agent });
    const res = await request(app).post('/admin/scenario').send({ scenario: 'errors' });
    expect(res.body).toMatchObject({ mode: 'error500', agent: { state: 'reporting' } });
    await request(app).get('/api/products').expect(500);
    expect(seen).toEqual([{ route: '/api/products', status: 500 }]);
  });

  it('agent silent: agent stops without a last report, the site keeps serving', async () => {
    const { agent, seen, instances } = fakeAgent();
    const app = createDemoTargetApp({ agent, initialMode: 'error500' });
    const res = await request(app).post('/admin/scenario').send({ scenario: 'agent-silent' });
    expect(res.body).toMatchObject({ mode: 'up', agent: { state: 'stopped' } });
    expect(instances[0].stop).toHaveBeenCalledWith({ flush: false });
    await request(app).get('/').expect(200);
    expect(seen).toEqual([]);
  });

  it('crash: agent stops and every connection drops; restore brings both back', async () => {
    const { agent, seen, instances } = fakeAgent();
    const app = createDemoTargetApp({ agent });

    const crashed = await request(app).post('/admin/scenario').send({ scenario: 'crash' });
    expect(crashed.body).toMatchObject({ mode: 'down', agent: { state: 'stopped' } });
    await expect(request(app).get('/')).rejects.toThrow(/socket hang up|ECONNRESET/);

    const restored = await request(app).post('/admin/scenario').send({ scenario: 'restore' });
    expect(restored.body).toMatchObject({ mode: 'up', agent: { state: 'reporting' } });
    expect(instances).toHaveLength(2); // a fresh agent instance
    await request(app).get('/').expect(200);
    expect(seen).toEqual([{ route: '/', status: 200 }]);
  });
});
