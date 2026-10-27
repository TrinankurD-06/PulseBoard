import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pulseboard } from '../src/index.js';

const ENDPOINT = 'https://pulseboard.example/api/v1/';

/** Fake fetch that records every report; `respond` decides the outcome. */
function fakeFetch(respond = () => ({ ok: true, status: 202 })) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const result = await respond(calls.length);
    if (result instanceof Error) throw result;
    return result;
  });
  fn.calls = calls;
  return fn;
}

const logger = () => ({ warn: vi.fn() });

/** Minimal Express-like req/res pair. */
function fakeExchange({ route, baseUrl = '', status = 200 } = {}) {
  const req = {
    route: route ? { path: route } : undefined,
    baseUrl,
    originalUrl: '/x/123?secret=1',
  };
  const res = new EventEmitter();
  res.statusCode = status;
  return { req, res };
}

const agents = [];
function makeAgent(options) {
  const agent = pulseboard({
    apiKey: 'pbk_test',
    endpoint: ENDPOINT,
    handleSignals: false,
    ...options,
  });
  agents.push(agent);
  return agent;
}

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.stop({ flush: false })));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('middleware', () => {
  it('calls next() synchronously and records on finish (once, even with finish + close)', async () => {
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch, logger: logger() });
    const { req, res } = fakeExchange({ route: '/orders/:id', baseUrl: '/api', status: 503 });
    const next = vi.fn();

    agent(req, res, next);
    expect(next).toHaveBeenCalledTimes(1); // not awaited, no added latency
    res.emit('finish');
    res.emit('close');

    await agent.flush();
    const [report] = fetch.calls.map((c) => c.body);
    expect(report).toMatchObject({ requests: 1, errors5xx: 1, errors4xx: 0 });
    expect(report.topRoutes).toEqual([
      { route: '/api/orders/:id', requests: 1, errors5xx: 1, p95Ms: expect.any(Number) },
    ]);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(JSON.stringify(report)).not.toContain('123');
  });

  it('never throws into the app, even with unusual req/res objects', () => {
    const agent = makeAgent({ fetch: fakeFetch(), logger: logger() });
    const next = vi.fn();
    expect(() => agent(undefined, undefined, next)).not.toThrow();
    expect(() => agent({}, {}, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('reports', () => {
  it('posts to <endpoint>/agent/report with the bearer key and the documented shape', async () => {
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch, logger: logger() });
    await agent.flush();

    const [{ url, init, body }] = fetch.calls;
    expect(url).toBe('https://pulseboard.example/api/v1/agent/report');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer pbk_test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(body).sort()).toEqual(
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
  });

  it('sends a report even with zero traffic (it doubles as a heartbeat)', async () => {
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch, logger: logger() });
    expect(await agent.flush()).toBe(true);
    expect(fetch.calls[0].body).toMatchObject({
      requests: 0,
      errors5xx: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      topRoutes: [],
    });
  });

  it('reports every window on a timer, interval clamped to 30-300 s', async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch();
    makeAgent({ fetch, logger: logger(), reportEverySec: 5 }); // clamped to 30
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('drops the window with one warning when PulseBoard is unreachable, then carries on', async () => {
    const log = logger();
    const fetch = fakeFetch((n) =>
      n === 1 ? new Error('connect ECONNREFUSED') : { ok: true, status: 202 },
    );
    const agent = makeAgent({ fetch, logger: log });
    const { req, res } = fakeExchange({ route: '/a' });

    agent(req, res, () => {});
    res.emit('finish');
    await expect(agent.flush()).resolves.toBe(false); // never rejects
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/Could not reach PulseBoard/);

    // Next window: sent normally, without the dropped data (no retry queue).
    await expect(agent.flush()).resolves.toBe(true);
    expect(fetch.calls[1].body.requests).toBe(0);
  });

  it('warns (without throwing) on a non-2xx answer, e.g. a revoked key', async () => {
    const log = logger();
    const agent = makeAgent({ fetch: fakeFetch(() => ({ ok: false, status: 401 })), logger: log });
    await expect(agent.flush()).resolves.toBe(false);
    expect(log.warn.mock.calls[0][0]).toMatch(/HTTP 401/);
  });
});

describe('configuration', () => {
  it('becomes a pass-through with a warning when misconfigured (never throws)', async () => {
    const log = logger();
    const agent = pulseboard({ endpoint: ENDPOINT, logger: log });
    const next = vi.fn();
    agent({}, {}, next);
    expect(next).toHaveBeenCalled();
    expect(log.warn.mock.calls[0][0]).toMatch(/No apiKey/);
    await expect(agent.flush()).resolves.toBe(false);
  });

  it('enabled: false sends nothing and logs nothing', async () => {
    const fetch = fakeFetch();
    const log = logger();
    const agent = pulseboard({
      apiKey: 'k',
      endpoint: ENDPOINT,
      enabled: false,
      fetch,
      logger: log,
    });
    agent({}, {}, () => {});
    await agent.flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('stop() and SIGTERM', () => {
  it('stop() flushes the last window, stops the timer and stops recording', async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch();
    const agent = makeAgent({ fetch, logger: logger() });
    await agent.stop();
    expect(fetch).toHaveBeenCalledTimes(1); // the final flush
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1); // no timer anymore

    const { req, res } = fakeExchange({ route: '/a' });
    const next = vi.fn();
    agent(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('flushes on SIGTERM without calling process.exit, and leaves other handlers in charge', async () => {
    const fetch = fakeFetch();
    const kill = vi.fn();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const before = process.listenerCount('SIGTERM');
    const agent = pulseboard({ apiKey: 'k', endpoint: ENDPOINT, fetch, kill, logger: logger() });
    agents.push(agent);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    const hostHandler = () => {};
    process.on('SIGTERM', hostHandler);
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    process.removeListener('SIGTERM', hostHandler);

    expect(exit).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled(); // the host has its own handler: it decides
    expect(process.listenerCount('SIGTERM')).toBe(before); // our listener removed itself
  });

  it('re-raises SIGTERM after flushing when nobody else handles it (keeps Node default)', async () => {
    const fetch = fakeFetch();
    const kill = vi.fn();
    vi.spyOn(process, 'listenerCount').mockReturnValue(0);
    const agent = pulseboard({ apiKey: 'k', endpoint: ENDPOINT, fetch, kill, logger: logger() });
    agents.push(agent);
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stop() removes the SIGTERM listener', async () => {
    const before = process.listenerCount('SIGTERM');
    const agent = pulseboard({
      apiKey: 'k',
      endpoint: ENDPOINT,
      fetch: fakeFetch(),
      logger: logger(),
    });
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    await agent.stop({ flush: false });
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
