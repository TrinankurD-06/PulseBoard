import { describe, expect, it, vi } from 'vitest';
import { guardNetworkFailure, probeReferenceHosts } from '../src/check/connectivity.js';
import { REFERENCE_HOSTS } from '../src/constants.js';

const reachable = (hosts) => async (host) => {
  if (!hosts.includes(host)) throw new Error('unreachable');
  return { statusCode: 200 };
};

describe('probeReferenceHosts', () => {
  it('is online when at least one host answers', async () => {
    const result = await probeReferenceHosts({ request: reachable([REFERENCE_HOSTS[1]]) });
    expect(result.online).toBe(true);
    expect(result.results).toEqual([
      { host: REFERENCE_HOSTS[0], ok: false },
      { host: REFERENCE_HOSTS[1], ok: true },
    ]);
  });

  it('is offline only when both fail', async () => {
    const result = await probeReferenceHosts({ request: reachable([]) });
    expect(result.online).toBe(false);
    expect(result.results.every((r) => !r.ok)).toBe(true);
  });

  it('passes the timeout and honours custom hosts', async () => {
    const request = vi.fn(async () => ({}));
    const result = await probeReferenceHosts({
      hosts: ['https://a.test'],
      timeoutMs: 123,
      request,
    });
    expect(request).toHaveBeenCalledWith('https://a.test', { timeoutMs: 123 });
    expect(result.online).toBe(true);
  });
});

describe('guardNetworkFailure', () => {
  const failure = (errorCode) => ({ ok: false, error: 'x', errorCode });

  it('stamps successes as ok without probing', async () => {
    const probe = vi.fn();
    const result = await guardNetworkFailure({ ok: true, errorCode: null }, { probe });
    expect(result.state).toBe('ok');
    expect(probe).not.toHaveBeenCalled();
  });

  it('never probes non-network errors', async () => {
    const probe = vi.fn();
    for (const code of ['HTTP_503', 'KEYWORD_MISSING', 'ECONNREFUSED', 'BLOCKED_TARGET']) {
      expect((await guardNetworkFailure(failure(code), { probe })).state).toBe('failed');
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it('network error with both reference hosts failing is unknown (checker offline)', async () => {
    const probe = async () => ({ online: false });
    for (const code of ['ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN']) {
      expect(await guardNetworkFailure(failure(code), { probe })).toMatchObject({
        ok: false,
        state: 'unknown',
        unknownReason: 'checker_offline',
        errorCode: code,
      });
    }
  });

  it('network error while a reference host is reachable is a real failure', async () => {
    const result = await guardNetworkFailure(failure('ETIMEDOUT'), {
      probe: async () => ({ online: true }),
    });
    expect(result.state).toBe('failed');
    expect(result.unknownReason).toBeUndefined();
  });

  it('works end to end with probeReferenceHosts and an injected request', async () => {
    const probe = () => probeReferenceHosts({ request: reachable([]) });
    expect((await guardNetworkFailure(failure('ENOTFOUND'), { probe })).state).toBe('unknown');
  });
});
