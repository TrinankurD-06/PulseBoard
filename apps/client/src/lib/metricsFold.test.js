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
    // Uptime comes from the API (incidents), never from live checks.
    expect(metric(next, 'uptime')).toBe(metric(data, 'uptime'));
    // Avg of (600 + 200) / 5.
    expect(metric(next, 'avgResponse').series.at(-1).v).toBe(160);
    expect(metric(next, 'avgResponse').current).toBe(160);
    // The input is untouched and unfoldable metrics keep their values.
    expect(metric(data, 'avgResponse').series.at(-1).v).not.toBe(160);
    expect(metric(next, 'p95')).toBe(metric(data, 'p95'));
  });

  it('a failed check raises failed, with change vs previous, and leaves uptime alone', () => {
    const data = makeMetrics({ type: 'http', range: '1h', now: NOW });
    const next = foldCheck(data, {
      lastCheckedAt: new Date(NOW + 1000).toISOString(),
      lastOk: false,
      lastResponseMs: null,
    });
    const { last, range } = next.live;
    expect(last).toMatchObject({ n: 5, ok: 4, nMs: 4 });
    expect(metric(next, 'uptime')).toBe(metric(data, 'uptime'));
    expect(metric(next, 'failed').series.at(-1).v).toBe(20);
    expect(range.n).toBe(data.live.range.n + 1);
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

    const series = metric(next, 'failed').series;
    expect(series).toHaveLength(96);
    expect(series.at(-1).t).toBe(new Date(lastStart + 2 * bucket).toISOString());
    expect(series.at(-2).v).toBeNull(); // the skipped bucket is a gap
    expect(series[0].t).toBe(metric(data, 'failed').series[2].t);
    expect(next.from).toBe(new Date(Date.parse(data.from) + 2 * bucket).toISOString());
    expect(next.live.last).toEqual({
      t: new Date(lastStart + 2 * bucket).toISOString(),
      n: 1,
      ok: 1,
      sumMs: 100,
      nMs: 1,
    });
    expect(series.at(-1).v).toBe(0);
    expect(next.timings).toHaveLength(96);
    expect(next.timings.at(-1).dnsMs).toBeNull();
    expect(next.timings.at(-1).t).toBe(series.at(-1).t);
  });

  it('clears the range accumulator when the shift passes the whole window', () => {
    const data = makeMetrics({ type: 'http', range: '1h', now: NOW });
    const at = new Date(NOW + 3 * 3_600_000).toISOString();
    const next = foldCheck(data, { lastCheckedAt: at, lastOk: true, lastResponseMs: 50 });
    expect(next.live.range).toEqual({ n: 1, ok: 1, sumMs: 50, nMs: 1 });
    expect(metric(next, 'failed').series.filter((p) => p.v != null)).toHaveLength(1);
  });

  it('heartbeat folds duration but not uptime, missed or lateness', () => {
    const data = makeMetrics({ type: 'heartbeat', range: '24h', now: NOW });
    const next = foldCheck(data, {
      lastCheckedAt: new Date(NOW + 1000).toISOString(),
      lastOk: true,
      lastResponseMs: 1000,
    });
    expect(metric(next, 'duration').series.at(-1).v).toBe(320);
    expect(metric(next, 'uptime')).toBe(metric(data, 'uptime'));
    expect(metric(next, 'missed')).toBe(metric(data, 'missed'));
    expect(metric(next, 'lateness')).toBe(metric(data, 'lateness'));
    expect(next.timings).toBeNull();
  });

  it('passes the offline flag through and clears it when a live result lands', () => {
    const data = makeMetrics({ type: 'http', range: '24h', now: NOW });
    const failed = metric(data, 'failed');
    const marked = {
      ...data,
      metrics: data.metrics.map((m) =>
        m.key === 'failed' || m.key === 'uptime'
          ? {
              ...m,
              series: m.series.map((p, i, all) =>
                i === all.length - 2 ? { ...p, v: null, offline: true } : p,
              ),
            }
          : m,
      ),
    };
    const at = new Date(NOW + 1000).toISOString();
    const next = foldCheck(marked, { lastCheckedAt: at, lastOk: true, lastResponseMs: 100 });
    expect(metric(next, 'failed').series.at(-2)).toMatchObject({ v: null, offline: true });
    // The untouched uptime series keeps its offline marker too.
    expect(metric(next, 'uptime').series.at(-2).offline).toBe(true);
    expect(failed.series).toBeDefined();
    const offlineLast = {
      ...marked,
      metrics: marked.metrics.map((m) =>
        m.key === 'failed'
          ? {
              ...m,
              series: m.series.map((p, i, all) =>
                i === all.length - 1 ? { ...p, v: null, offline: true } : p,
              ),
            }
          : m,
      ),
    };
    const back = foldCheck(offlineLast, { lastCheckedAt: at, lastOk: true, lastResponseMs: 100 });
    expect(metric(back, 'failed').series.at(-1).offline).toBeUndefined();
  });

  it('ignores a check the checker could not judge (unknown)', () => {
    const data = makeMetrics({ type: 'http', range: '24h', now: NOW });
    const at = new Date(NOW + 1000).toISOString();
    expect(foldCheck(data, { lastCheckedAt: at, lastOk: false, lastState: 'unknown' })).toBe(data);
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
