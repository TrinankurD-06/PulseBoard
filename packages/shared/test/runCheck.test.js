import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorCodeOf, runHttpCheck } from '../src/check/runCheck.js';

// A local server with one route per scenario, listening dual-stack ('::') so both
// 127.0.0.1 and localhost/::1 reach it. Private targets are allowed in these tests.
let server;
let base;
let lastHeaders = null; // headers of the latest request to /record
let trickleClosedEarly = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    switch (path) {
      case '/head-405':
      case '/head-501':
        // A server that doesn't implement HEAD.
        res.statusCode = req.method === 'HEAD' ? Number(path.slice(-3)) : 200;
        res.end(req.method === 'HEAD' ? '' : 'healthy');
        return;
      case '/record':
        lastHeaders = req.headers;
        res.end('ok');
        return;
      case '/trickle': {
        // Headers right away, then a body that takes ~3 s to arrive.
        trickleClosedEarly = false;
        res.writeHead(200, { 'content-type': 'text/plain' });
        let sent = 0;
        const timer = setInterval(() => {
          sent += 1;
          if (sent > 30) {
            clearInterval(timer);
            res.end('done');
          } else res.write('x'.repeat(1024));
        }, 100);
        res.on('close', () => {
          if (sent <= 30) trickleClosedEarly = true;
          clearInterval(timer);
        });
        return;
      }
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

describe('runHttpCheck: error codes', () => {
  it('has no code on success', async () => {
    expect((await run('/ok')).errorCode).toBeNull();
  });

  it('HTTP_<status> for an unexpected status', async () => {
    expect((await run('/500')).errorCode).toBe('HTTP_500');
  });

  it('KEYWORD_MISSING when the keyword is absent', async () => {
    expect((await run('/ok', { keyword: 'degraded' })).errorCode).toBe('KEYWORD_MISSING');
  });

  it('ETIMEDOUT for the runner timeout', async () => {
    expect((await run('/slow', { timeoutMs: 300 })).errorCode).toBe('ETIMEDOUT');
  });

  it('TOO_MANY_REDIRECTS', async () => {
    expect((await run('/loop')).errorCode).toBe('TOO_MANY_REDIRECTS');
  });

  it('system codes pass through (ECONNRESET, ECONNREFUSED)', async () => {
    expect((await run('/reset')).errorCode).toBe('ECONNRESET');
    const refused = await runHttpCheck(
      { ...target('/'), url: 'http://127.0.0.1:1/' },
      { allowPrivate: true },
    );
    expect(refused.errorCode).toBe('ECONNREFUSED');
  });

  it('BLOCKED_TARGET for the SSRF guard', async () => {
    expect((await runHttpCheck(target('/ok'))).errorCode).toBe('BLOCKED_TARGET');
    const port = new URL(base).port;
    const named = await runHttpCheck({ ...target('/ok'), url: `http://localhost:${port}/ok` });
    expect(named.errorCode).toBe('BLOCKED_TARGET');
  });

  it('errorCodeOf falls back to REQUEST_FAILED', () => {
    expect(errorCodeOf(new Error('x'))).toBe('REQUEST_FAILED');
    expect(errorCodeOf({ code: 'EPIPE' })).toBe('EPIPE');
  });
});

describe('runHttpCheck: cheap requests (U1)', () => {
  it.each(['/head-405', '/head-501'])(
    'falls back from HEAD to GET when the server rejects HEAD (%s)',
    async (path) => {
      const result = await run(path, { method: 'HEAD' });
      expect(result).toMatchObject({
        ok: true,
        statusCode: 200,
        requestsSent: 2,
        headUnsupported: true,
      });
    },
  );

  it('goes straight to GET once the monitor is known not to support HEAD', async () => {
    const result = await run('/head-405', { method: 'HEAD', headUnsupported: true });
    expect(result).toMatchObject({ ok: true, requestsSent: 1, headUnsupported: false });
  });

  it('uses HEAD when the server supports it (one request, no fallback)', async () => {
    expect(await run('/ok', { method: 'HEAD' })).toMatchObject({
      ok: true,
      statusCode: 200,
      requestsSent: 1,
      headUnsupported: false,
    });
  });

  it('does not download the body when no keyword is set', async () => {
    const result = await run('/trickle', { timeoutMs: 5000 });
    expect(result).toMatchObject({ ok: true, statusCode: 200 });
    expect(result.totalMs).toBeLessThan(1000); // the full body takes ~3 s
    expect(result.timings.ttfbMs).toBeGreaterThanOrEqual(0); // TTFB is still measured
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(trickleClosedEarly).toBe(true); // we hung up before the body finished
  });

  it('still downloads the body when a keyword is set', async () => {
    const result = await run('/trickle', { timeoutMs: 5000, keyword: 'done' });
    expect(result.ok).toBe(true);
    expect(result.totalMs).toBeGreaterThan(2500);
  });

  it('identifies itself with the bot User-Agent and the X-PulseBoard-Check header', async () => {
    await runHttpCheck(target('/record'), {
      allowPrivate: true,
      appUrl: 'https://app.pulseboard.dev/',
    });
    expect(lastHeaders['user-agent']).toBe('PulseBoard/1.0 (+https://app.pulseboard.dev/bot)');
    expect(lastHeaders['x-pulseboard-check']).toBe('1');
  });

  it('custom headers cannot remove the check marker', async () => {
    await run('/record', { headers: { 'X-PulseBoard-Check': '0', 'X-Api-Key': 'k' } });
    expect(lastHeaders['x-pulseboard-check']).toBe('1');
    expect(lastHeaders['x-api-key']).toBe('k');
  });

  it('counts every request sent, including redirect hops', async () => {
    expect((await run('/redirect')).requestsSent).toBe(2); // 302 + final
    expect((await run('/loop')).requestsSent).toBe(4); // 1 + 3 redirects, then gives up
    expect((await run('/ok')).requestsSent).toBe(1);
  });
});
