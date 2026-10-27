import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsKey } from '../api/metrics.js';
import { makeMetrics } from '../lib/metricsFixture.js';
import { createMetricsFolder, FLUSH_MS } from './metricsLive.js';

const NOW = Date.parse('2026-10-27T12:07:30.000Z');
const event = (offsetMs, extra = {}) => ({
  monitorId: 'm1',
  workspaceId: 'w1',
  lastCheckedAt: new Date(NOW + offsetMs).toISOString(),
  lastOk: true,
  lastResponseMs: 100,
  ...extra,
});

describe('createMetricsFolder', () => {
  let client;
  let folder;
  beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient();
    client.setQueryData(metricsKey('w1', 'm1', '24h'), makeMetrics({ range: '24h', now: NOW }));
    client.setQueryData(metricsKey('w1', 'm1', '1h'), makeMetrics({ range: '1h', now: NOW }));
    client.setQueryData(metricsKey('w1', 'm2', '24h'), makeMetrics({ range: '24h', now: NOW }));
    folder = createMetricsFolder(client);
  });
  afterEach(() => {
    folder.dispose();
    vi.useRealTimers();
  });

  const n = (mid, range) => client.getQueryData(metricsKey('w1', mid, range)).live.range.n;

  it('buffers events and flushes once per second to every cached range of the monitor', () => {
    const before = n('m1', '24h');
    folder.push(event(2000));
    folder.push(event(3000));
    folder.push(event(1500)); // out of order: folded oldest first, all newer than lastAt
    expect(n('m1', '24h')).toBe(before);

    vi.advanceTimersByTime(FLUSH_MS);
    expect(n('m1', '24h')).toBe(before + 3);
    expect(client.getQueryData(metricsKey('w1', 'm1', '1h')).live.last.n).toBe(7);
    // Another monitor is untouched.
    expect(n('m2', '24h')).toBe(before);
  });

  it('ignores events that are not newer than live.lastAt and never refetches', () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    const lastAt = client.getQueryData(metricsKey('w1', 'm1', '24h')).live.lastAt;
    folder.push(event(0, { lastCheckedAt: lastAt }));
    vi.advanceTimersByTime(FLUSH_MS);
    expect(client.getQueryData(metricsKey('w1', 'm1', '24h')).live.last.n).toBe(4);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing for an uncached monitor and survives dispose', () => {
    folder.push(event(2000, { monitorId: 'other' }));
    folder.dispose();
    vi.advanceTimersByTime(FLUSH_MS * 2);
    expect(client.getQueryData(metricsKey('w1', 'other', '24h'))).toBeUndefined();
  });
});
