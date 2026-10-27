import { describe, expect, it } from 'vitest';
import { foldCheck } from './metricsFold.js';
import { makeMetrics } from './metricsFixture.js';

const NOW = Date.parse('2026-10-27T12:07:30.000Z');
const metric = (data, key) => data.metrics.find((m) => m.key === key);

describe('foldCheck', () => {
  it('adds a check to the last bucket and range accumulators', () => {
    const data = makeMetrics({ type: 'http', range: '24h', now: NOW });
    const at = new Date(NOW + 5000).toISOString();
    const next = foldCheck(data, { lastCheckedAt: at, lastOk: true, lastResponseMs: 200 });

    expect(next.live.lastAt).toBe(at);
    expect(next.live.last).toMatchObject({ n: 5, ok: 5, sumMs: 800, nMs: 5 });
    expect(next.live.range.n).toBe(data.live.range.n + 1);
    // 5 of 5 ok in the last bucket, 1 avg of (600 + 200) / 5.
    expect(metric(next, 'uptime').series.at(-1).v).toBe(100);
    expect(metric(next, 'avgResponse').series.at(-1).v).toBe(160);
    expect(metric(next, 'avgResponse').current).toBe(160);
    // The input is untouched and unfoldable metrics keep their values.
    expect(metric(data, 'avgResponse').series.at(-1).v).not.toBe(160);
    expect(metric(next, 'p95')).toBe(metric(data, 'p95'));
  });

  it('a failed check lowers uptime and raises failed, with change vs previous', () => {
    const data = makeMetrics({ type: 'http', range: '1h', now: NOW });
    const next = foldCheck(data, {
      lastCheckedAt: new Date(NOW + 1000).toISOString(),
      lastOk: false,
      lastResponseMs: null,
    });
    const { last, range } = next.live;
    expect(last).toMatchObject({ n: 5, ok: 4, nMs: 4 });
    expect(metric(next, 'uptime').series.at(-1).v).toBe(80);
    expect(metric(next, 'failed').series.at(-1).v).toBe(20);
    expect(metric(next, 'uptime').value).toBe(Math.round((range.ok / range.n) * 10000) / 100);
    const m = metric(next, 'failed');
    expect(m.change).toBe(Math.round(((m.value - m.previous) / Math.abs(m.previous)) * 1000) / 10);
    expect(m.peak).toBeGreaterThanOrEqual(20);
  });

  it('ignores a check that is not newer than live.lastAt', () => {
    const data = makeMetrics({ type: 'http', range: '24h', now: NOW });
    expect(foldCheck(data, { lastCheckedAt: data.live.lastAt, lastOk: true })).toBe(data);
    expect(
      foldCheck(data, {
        lastCheckedAt: new Date(Date.parse(data.live.lastAt) - 1).toISOString(),
        lastOk: true,
      }),
    ).toBe(data);
  });

  it('ignores missing data, empty responses and bad input', () => {
    const empty = makeMetrics({ range: '24h', now: NOW, empty: true });
    const ok = { lastCheckedAt: new Date(NOW + 1000).toISOString(), lastOk: true };
    expect(foldCheck(undefined, ok)).toBeUndefined();
    expect(foldCheck(empty, ok)).toBe(empty);
    const data = makeMetrics({ range: '24h', now: NOW });
    expect(foldCheck(data, { lastCheckedAt: 'nope', lastOk: true })).toBe(data);
    expect(foldCheck(data, {})).toBe(data);
  });

  it('shifts the grid when the check is past the last bucket', () => {
    const data = makeMetrics({ type: 'http', range: '24h', now: NOW });
    const bucket = data.bucketMs;
    const lastStart = Date.parse(data.live.last.t);
    const at = new Date(lastStart + 2 * bucket + 1000).toISOString();
    const next = foldCheck(data, { lastCheckedAt: at, lastOk: true, lastResponseMs: 100 });

    const series = metric(next, 'uptime').series;
    expect(series).toHaveLength(96);
    expect(series.at(-1).t).toBe(new Date(lastStart + 2 * bucket).toISOString());
    expect(series.at(-2).v).toBeNull(); // the skipped bucket is a gap
    expect(series[0].t).toBe(metric(data, 'uptime').series[2].t);
    expect(next.from).toBe(new Date(Date.parse(data.from) + 2 * bucket).toISOString());
    expect(next.live.last).toEqual({
      t: new Date(lastStart + 2 * bucket).toISOString(),
      n: 1,
      ok: 1,
      sumMs: 100,
      nMs: 1,
    });
    expect(series.at(-1).v).toBe(100);
    expect(next.timings).toHaveLength(96);
    expect(next.timings.at(-1).dnsMs).toBeNull();
    expect(next.timings.at(-1).t).toBe(series.at(-1).t);
  });

  it('clears the range accumulator when the shift passes the whole window', () => {
    const data = makeMetrics({ type: 'http', range: '1h', now: NOW });
    const at = new Date(NOW + 3 * 3_600_000).toISOString();
    const next = foldCheck(data, { lastCheckedAt: at, lastOk: true, lastResponseMs: 50 });
    expect(next.live.range).toEqual({ n: 1, ok: 1, sumMs: 50, nMs: 1 });
    expect(metric(next, 'uptime').series.filter((p) => p.v != null)).toHaveLength(1);
  });

  it('heartbeat folds uptime and duration but not missed or lateness', () => {
    const data = makeMetrics({ type: 'heartbeat', range: '24h', now: NOW });
    const next = foldCheck(data, {
      lastCheckedAt: new Date(NOW + 1000).toISOString(),
      lastOk: true,
      lastResponseMs: 1000,
    });
    expect(metric(next, 'duration').series.at(-1).v).toBe(320);
    expect(metric(next, 'uptime').series.at(-1).v).toBe(100);
    expect(metric(next, 'missed')).toBe(metric(data, 'missed'));
    expect(metric(next, 'lateness')).toBe(metric(data, 'lateness'));
    expect(next.timings).toBeNull();
  });

  it('agent metrics are left for the next refetch', () => {
    const data = makeMetrics({ type: 'agent', range: '24h', now: NOW });
    const next = foldCheck(data, {
      lastCheckedAt: new Date(NOW + 1000).toISOString(),
      lastOk: true,
    });
    expect(next.metrics).toEqual(data.metrics);
    expect(next.live.lastAt).toBe(new Date(NOW + 1000).toISOString());
  });
});
