import { describe, expect, it, vi } from 'vitest';
import { AGENT_VERSION, heartbeat } from '../src/index.js';

const ENDPOINT = 'https://pulseboard.example/api/v1/';
const fixedNow = () => new Date('2026-10-29T12:00:00.000Z');

function fakeFetch(result = { ok: true, status: 202 }) {
  return vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
}

describe('heartbeat(apiKey, endpoint)', () => {
  it('sends one empty report with the bearer key and resolves true', async () => {
    const fetch = fakeFetch();
    await expect(heartbeat('pbk_cron', ENDPOINT, { fetch, now: fixedNow })).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://pulseboard.example/api/v1/agent/report');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer pbk_cron');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toMatchObject({
      windowStart: '2026-10-29T11:59:00.000Z',
      windowEnd: '2026-10-29T12:00:00.000Z',
      requests: 0,
      errors5xx: 0,
      errors4xx: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      topRoutes: [],
      agentVersion: AGENT_VERSION,
    });
  });

  it('sends serviceName when given', async () => {
    const fetch = fakeFetch();
    await heartbeat('k', ENDPOINT, { fetch, serviceName: 'nightly-backup' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).serviceName).toBe('nightly-backup');
  });

  it('resolves false (never rejects) when PulseBoard is unreachable or refuses the key', async () => {
    await expect(
      heartbeat('k', ENDPOINT, { fetch: fakeFetch(new Error('ECONNREFUSED')) }),
    ).resolves.toBe(false);
    await expect(
      heartbeat('k', ENDPOINT, { fetch: fakeFetch({ ok: false, status: 401 }) }),
    ).resolves.toBe(false);
  });

  it('throws a clear error for a missing apiKey or a bad endpoint', () => {
    expect(() => heartbeat('', ENDPOINT)).toThrow(/apiKey is required/);
    expect(() => heartbeat(undefined, ENDPOINT)).toThrow(/apiKey is required/);
    expect(() => heartbeat('k', undefined)).toThrow(/endpoint is required/);
    expect(() => heartbeat('k', 'nope')).toThrow(/not a valid URL/);
  });
});
