import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pulseboard } from '../src/index.js';

const ENDPOINT = 'https://pulseboard.example/api/v1';

function fakeFetch(respond = () => ({ ok: true, status: 202 })) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const result = respond();
    if (result instanceof Error) throw result;
    return result;
  });
  fn.calls = calls;
  return fn;
}

function buildApp(agent) {
  const app = express();
  app.use(express.json());
  if (agent) app.use(agent);
  const api = express.Router();
  api.get('/orders/:id', (req, res) => res.json({ id: req.params.id }));
  api.post('/login', (_req, res) => res.status(401).json({ error: 'nope' }));
  api.get('/boom', () => {
    throw new Error('kaboom');
  });
  app.use('/api', api);
  app.get('/', (_req, res) => res.send('home'));
  // Keeps Express's default error output out of the test log.
  app.use((_err, _req, res, _next) => res.status(500).json({ error: 'internal' }));
  return app;
}

const agents = [];
function makeAgent(options) {
  const agent = pulseboard({
    apiKey: 'pbk_secret_key',
    endpoint: ENDPOINT,
    handleSignals: false,
    logger: { warn: vi.fn() },
    ...options,
  });
  agents.push(agent);
  return agent;
}

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.stop({ flush: false })));
});

describe('inside a real Express app', () => {
  it('answers exactly as it does without the agent', async () => {
    const plain = buildApp();
    const measured = buildApp(makeAgent({ fetch: fakeFetch() }));

    for (const [method, path, status] of [
      ['get', '/', 200],
      ['get', '/api/orders/8131', 200],
      ['post', '/api/login', 401],
      ['get', '/api/boom', 500],
      ['get', '/missing', 404],
    ]) {
      const a = await request(plain)[method](path);
      const b = await request(measured)[method](path);
      expect(b.status).toBe(status);
      expect(b.status).toBe(a.status);
      expect(b.text).toBe(a.text);
    }
  });

  it('counts requests, 4xx and 5xx and reports route patterns, not URLs', async () => {
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch });
    const app = buildApp(agent);

    await request(app).get('/api/orders/8131?token=abc');
    await request(app).get('/api/orders/9');
    await request(app).post('/api/login').send({ password: 'hunter2' });
    await request(app).get('/api/boom');
    await request(app).get('/nothing-here');
    expect(fetch).not.toHaveBeenCalled(); // nothing is sent per request

    await agent.flush();
    const [{ body }] = fetch.calls;
    expect(body).toMatchObject({ requests: 5, errors5xx: 1, errors4xx: 2 });
    const routes = Object.fromEntries(body.topRoutes.map((r) => [r.route, r.requests]));
    expect(routes).toEqual({
      '/api/orders/:id': 2,
      '/api/login': 1,
      // Known limit: when a handler throws, Express has already left the router by the
      // time the error handler answers, so the mount prefix (/api) is gone.
      '/boom': 1,
      unmatched: 1,
    });
  });

  it('captures no URLs, query strings, headers or bodies', async () => {
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch });
    const app = buildApp(agent);

    await request(app)
      .post('/api/login?session=s3cr3t-query')
      .set('Cookie', 'sid=cookie-value-123')
      .set('Authorization', 'Bearer user-token-456')
      .set('X-Forwarded-For', '203.0.113.77')
      .send({ password: 'hunter2' });
    await request(app).get('/api/orders/8131?token=abc');
    await agent.flush();

    const sent = JSON.stringify(fetch.calls[0].body);
    for (const secret of [
      's3cr3t-query',
      'session=',
      'token=',
      '8131',
      'cookie-value-123',
      'user-token-456',
      '203.0.113.77',
      'hunter2',
      '127.0.0.1',
      'superagent',
    ]) {
      expect(sent).not.toContain(secret);
    }
    // Only these keys ever leave the process.
    expect(Object.keys(fetch.calls[0].body).sort()).toEqual(
      [
        'agentVersion',
        'errors4xx',
        'errors5xx',
        'hostname',
        'p50Ms',
        'p95Ms',
        'p99Ms',
        'requests',
        'topRoutes',
        'uptimeSec',
        'windowEnd',
        'windowStart',
      ].sort(),
    );
    // The key travels in the header only, never in the body.
    expect(sent).not.toContain('pbk_secret_key');
    expect(fetch.calls[0].init.headers.authorization).toBe('Bearer pbk_secret_key');
  });

  it('masks ids in a parameterised mount path', async () => {
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch });
    const app = express();
    app.use(agent);
    const router = express.Router({ mergeParams: true });
    router.get('/profile', (_req, res) => res.send('ok'));
    app.use('/users/:userId', router);

    await request(app).get('/users/42/profile');
    await request(app).get('/users/3f2b8c1e-9d4a-4c11-8a55-0e6f7a1b2c3d/profile');
    await agent.flush();
    expect(fetch.calls[0].body.topRoutes).toEqual([
      expect.objectContaining({ route: '/users/:id/profile', requests: 2 }),
    ]);
  });

  it('adds no measurable latency', async () => {
    const plain = buildApp();
    const measured = buildApp(makeAgent({ fetch: fakeFetch() }));
    const servers = [plain, measured].map((app) => app.listen(0));
    try {
      const median = async (server) => {
        const times = [];
        for (let i = 0; i < 150; i += 1) {
          const start = process.hrtime.bigint();
          await request(server).get('/api/orders/1');
          times.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        return times.sort((a, b) => a - b)[times.length >> 1];
      };
      await median(servers[0]); // warm-up
      const base = await median(servers[0]);
      const withAgent = await median(servers[1]);
      expect(withAgent - base).toBeLessThan(5);
    } finally {
      servers.forEach((server) => server.close());
    }
  });

  it('keeps serving normally while PulseBoard is down', async () => {
    const log = { warn: vi.fn() };
    const fetch = fakeFetch(() => new Error('ECONNREFUSED'));
    const agent = makeAgent({ fetch, logger: log });
    const app = buildApp(agent);

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get('/api/orders/1');
      expect(res.status).toBe(200);
    }
    await expect(agent.flush()).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect((await request(app).get('/')).text).toBe('home');
  });
});
