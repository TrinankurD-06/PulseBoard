import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runHttpCheck } from '../src/check/runCheck.js';

// A local server with one route per scenario, listening dual-stack ('::') so both
// 127.0.0.1 and localhost/::1 reach it. Private targets are allowed in these tests.
let server;
let base;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    switch (path) {
      case '/ok':
        res.end('all systems healthy');
        return;
      case '/500':
        res.statusCode = 500;
        res.end('boom');
        return;
      case '/slow':
        setTimeout(() => res.end('late'), 1500);
        return;
      case '/redirect':
        res.writeHead(302, { location: '/ok' }).end();
        return;
      case '/loop':
        res.writeHead(301, { location: '/loop' }).end();
        return;
      case '/method':
        res.end(req.method);
        return;
      case '/headers':
        res.end(JSON.stringify(req.headers));
        return;
      case '/big':
        // 3 MB body; the keyword is at the very end, beyond the 1 MB read cap.
        res.end(`${'x'.repeat(3 * 1024 * 1024)}needle`);
        return;
      case '/reset':
        req.socket.destroy();
        return;
      default:
        res.statusCode = 404;
        res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '::', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const target = (path, overrides = {}) => ({
  url: `${base}${path}`,
  method: 'GET',
  timeoutMs: 1000,
  expectedStatus: { min: 200, max: 399 },
  keyword: null,
  ...overrides,
});
const run = (path, overrides) => runHttpCheck(target(path, overrides), { allowPrivate: true });

describe('runHttpCheck', () => {
  it('reports a successful check with a full timing breakdown', async () => {
    const result = await run('/ok');
    expect(result).toMatchObject({ ok: true, statusCode: 200, error: null, sslExpiresAt: null });
    expect(result.totalMs).toBeGreaterThan(0);
    expect(Object.keys(result.timings).sort()).toEqual([
      'dnsMs',
      'downloadMs',
      'tcpMs',
      'tlsMs',
      'ttfbMs',
    ]);
    // IP literal: no DNS phase; plain HTTP: no TLS phase.
    expect(result.timings.dnsMs).toBe(0);
    expect(result.timings.tlsMs).toBe(0);
    expect(result.timings.ttfbMs).toBeGreaterThanOrEqual(0);
  });

  it('measures DNS when the URL uses a hostname', async () => {
    const port = new URL(base).port;
    const result = await runHttpCheck(
      { ...target('/ok'), url: `http://localhost:${port}/ok` },
      { allowPrivate: true },
    );
    expect(result.ok).toBe(true);
    expect(result.timings.dnsMs).toEqual(expect.any(Number));
  });

  it('fails on an unexpected status code', async () => {
    expect(await run('/500')).toMatchObject({
      ok: false,
      statusCode: 500,
      error: 'Unexpected status 500 (expected 200–399)',
    });
  });

  it('checks the keyword against the body', async () => {
    expect((await run('/ok', { keyword: 'healthy' })).ok).toBe(true);
    expect(await run('/ok', { keyword: 'degraded' })).toMatchObject({
      ok: false,
      error: 'Keyword "degraded" not found in response',
    });
  });

  it('reads at most 1 MB of body for keyword checks', async () => {
    const result = await run('/big', { keyword: 'needle', timeoutMs: 5000 });
    expect(result).toMatchObject({ ok: false, statusCode: 200 });
    expect(result.error).toMatch(/not found/);
  });

  it('enforces the timeout', async () => {
    const result = await run('/slow', { timeoutMs: 300 });
    expect(result).toMatchObject({ ok: false, statusCode: null, error: 'Timed out after 300ms' });
    expect(result.totalMs).toBeLessThan(1000);
  });

  it('follows redirects and evaluates the final response', async () => {
    expect(await run('/redirect')).toMatchObject({ ok: true, statusCode: 200 });
  });

  it('gives up after 3 redirects', async () => {
    expect(await run('/loop')).toMatchObject({
      ok: false,
      error: 'Too many redirects (more than 3)',
    });
  });

  it('uses the configured method and sends custom headers', async () => {
    expect((await run('/method', { method: 'POST', keyword: 'POST' })).ok).toBe(true);
    const headers = await run('/headers', { headers: { 'X-Api-Key': 'abc' }, keyword: '"abc"' });
    expect(headers.ok).toBe(true);
  });

  it('accepts headers stored as a Map (Mongoose documents)', async () => {
    const result = await run('/headers', { headers: new Map([['X-Key', 'zz9']]), keyword: 'zz9' });
    expect(result.ok).toBe(true);
  });

  it('reports connection errors in plain language', async () => {
    expect((await run('/reset')).error).toMatch(/reset|hang up/i);
    const refused = await runHttpCheck(
      { ...target('/'), url: 'http://127.0.0.1:1/' },
      { allowPrivate: true },
    );
    expect(refused).toMatchObject({ ok: false, error: 'Connection refused' });
  });

  it('blocks private targets unless allowed (IP literal and hostname)', async () => {
    const literal = await runHttpCheck(target('/ok'));
    expect(literal).toMatchObject({ ok: false, error: 'Blocked request to a private address' });

    const port = new URL(base).port;
    const named = await runHttpCheck({ ...target('/ok'), url: `http://localhost:${port}/ok` });
    expect(named.ok).toBe(false);
    expect(named.error).toMatch(/Blocked connection to private address/);
  });
});
