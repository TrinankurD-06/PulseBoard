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
    expect(log.warn.mock.calls[0][0]).toMatch(/could not reach PulseBoard/);

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
  it('throws a clear error at start-up when the apiKey is missing', () => {
    expect(() => pulseboard({ endpoint: ENDPOINT })).toThrow(/apiKey is required/);
    expect(() => pulseboard({ apiKey: '  ', endpoint: ENDPOINT })).toThrow(/apiKey is required/);
    expect(() => pulseboard({ apiKey: 42, endpoint: ENDPOINT })).toThrow(TypeError);
  });

  it('validates the other options', () => {
    const base = { apiKey: 'k', endpoint: ENDPOINT, handleSignals: false };
    expect(() => pulseboard({ apiKey: 'k' })).toThrow(/endpoint is required/);
    expect(() => pulseboard({ ...base, endpoint: 'not a url' })).toThrow(/not a valid URL/);
    expect(() => pulseboard({ ...base, endpoint: 'ftp://x/api/v1' })).toThrow(/http/);
    expect(() => pulseboard({ ...base, intervalSec: 'soon' })).toThrow(/intervalSec/);
    expect(() => pulseboard({ ...base, intervalSec: -5 })).toThrow(/intervalSec/);
    expect(() => pulseboard({ ...base, serviceName: 7 })).toThrow(/serviceName/);
    expect(() => pulseboard({ ...base, fetch: null })).toThrow(/fetch is not available/);
    expect(() => pulseboard(null)).toThrow(/options must be an object/);
  });

  it('accepts intervalSec and its alias reportEverySec', async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch();
    makeAgent({ fetch, logger: logger(), intervalSec: 45 });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends serviceName with every report when set', async () => {
    const fetch = fakeFetch();
    await makeAgent({ fetch, logger: logger(), serviceName: 'checkout-api' }).flush();
    expect(fetch.calls[0].body.serviceName).toBe('checkout-api');
  });

  it('logs one report line per window only with debug: true', async () => {
    const quiet = { warn: vi.fn(), info: vi.fn() };
    await makeAgent({ fetch: fakeFetch(), logger: quiet }).flush();
    expect(quiet.info).not.toHaveBeenCalled();

    const loud = { warn: vi.fn(), info: vi.fn() };
    await makeAgent({ fetch: fakeFetch(), logger: loud, debug: true }).flush();
    expect(loud.info).toHaveBeenCalledTimes(1);
    expect(loud.info.mock.calls[0][0]).toMatch(/report sent: 0 requests/);
  });

  it('warns once per outage, not once per window, and says when it recovers', async () => {
    const log = { warn: vi.fn(), info: vi.fn() };
    let up = false;
    const fetch = fakeFetch(() => (up ? { ok: true, status: 202 } : new Error('offline')));
    const agent = makeAgent({ fetch, logger: log });
    await agent.flush();
    await agent.flush();
    await agent.flush();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3); // still trying every window, no retry storm

    up = true;
    await expect(agent.flush()).resolves.toBe(true);
    expect(log.info).toHaveBeenCalledTimes(1);

    up = false;
    await agent.flush(); // a new outage warns again
    expect(log.warn).toHaveBeenCalledTimes(2);
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

describe('stop(), SIGTERM and beforeExit', () => {
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

  it('flushes once on beforeExit and removes its listeners', async () => {
    const fetch = fakeFetch();
    const before = process.listenerCount('beforeExit');
    const agent = pulseboard({ apiKey: 'k', endpoint: ENDPOINT, fetch, logger: logger() });
    agents.push(agent);
    expect(process.listenerCount('beforeExit')).toBe(before + 1);

    process.emit('beforeExit', 0);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(process.listenerCount('beforeExit')).toBe(before);
    process.emit('beforeExit', 0); // a second exit attempt must not send again
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('handleSignals: false registers no process listeners', async () => {
    const sigterm = process.listenerCount('SIGTERM');
    const exit = process.listenerCount('beforeExit');
    makeAgent({ fetch: fakeFetch(), logger: logger() });
    expect(process.listenerCount('SIGTERM')).toBe(sigterm);
    expect(process.listenerCount('beforeExit')).toBe(exit);
  });
});
