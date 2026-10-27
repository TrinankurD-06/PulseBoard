import { describe, expect, it } from 'vitest';
import { createAggregator, OTHER_ROUTE, routeOf } from '../src/aggregator.js';
import { createReservoir, percentile } from '../src/stats.js';

describe('percentile (nearest rank)', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('returns real samples at the expected ranks', () => {
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile(values, 100)).toBe(100);
  });

  it('handles tiny and empty inputs', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([1, 2], 50)).toBe(1);
    expect(percentile([0.04, 12.345], 95)).toBe(12.3);
  });
});

describe('createReservoir', () => {
  it('never keeps more than its capacity, however many values arrive', () => {
    const reservoir = createReservoir(100);
    for (let i = 0; i < 50_000; i += 1) reservoir.add(i);
    expect(reservoir.size).toBe(100);
    expect(reservoir.seen).toBe(50_000);
  });

  it('keeps everything while below capacity', () => {
    const reservoir = createReservoir(10);
    [5, 1, 3].forEach((v) => reservoir.add(v));
    expect(reservoir.sorted()).toEqual([1, 3, 5]);
  });
});

describe('routeOf: patterns only, never real URLs', () => {
  it('uses the matched route pattern, joined with the router mount path', () => {
    expect(
      routeOf({
        route: { path: '/orders/:id' },
        baseUrl: '/api',
        originalUrl: '/api/orders/8131?token=x',
      }),
    ).toBe('/api/orders/:id');
    expect(routeOf({ route: { path: '/' }, baseUrl: '/health' })).toBe('/health');
    expect(routeOf({ route: { path: '/login' }, baseUrl: '' })).toBe('/login');
  });

  it('reports requests that matched no route as "unmatched"', () => {
    expect(routeOf({ originalUrl: '/users/42?email=a@b.c', url: '/users/42' })).toBe('unmatched');
    expect(routeOf(undefined)).toBe('unmatched');
  });

  it('stringifies regex routes instead of leaking the path', () => {
    expect(routeOf({ route: { path: /^\/files\/.*$/ }, baseUrl: '' })).toBe('/^\\/files\\/.*$/');
  });
});

describe('createAggregator', () => {
  const clock = () => {
    let t = Date.parse('2026-10-27T03:00:00Z');
    return { now: () => new Date(t), advance: (ms) => (t += ms) };
  };

  it('counts requests, 4xx and 5xx, and computes percentiles and top routes', () => {
    const c = clock();
    const agg = createAggregator({ now: c.now });
    for (let i = 1; i <= 100; i += 1) {
      agg.record({ status: 200, durationMs: i, route: '/api/orders/:id' });
    }
    agg.record({ status: 404, durationMs: 1, route: 'unmatched' });
    agg.record({ status: 503, durationMs: 500, route: '/api/pay' });
    c.advance(60_000);
    const report = agg.snapshot(c.now());

    expect(report).toMatchObject({
      windowStart: '2026-10-27T03:00:00.000Z',
      windowEnd: '2026-10-27T03:01:00.000Z',
      requests: 102,
      errors4xx: 1,
      errors5xx: 1,
      p50Ms: 50,
      p99Ms: 100,
    });
    expect(report.topRoutes[0]).toMatchObject({
      route: '/api/orders/:id',
      requests: 100,
      errors5xx: 0,
      p95Ms: 95,
    });
    expect(report.topRoutes.find((r) => r.route === '/api/pay')).toMatchObject({
      errors5xx: 1,
      p95Ms: 500,
    });
  });

  it('starts a fresh window after each snapshot', () => {
    const agg = createAggregator();
    agg.record({ status: 200, durationMs: 5, route: '/a' });
    agg.snapshot();
    const next = agg.snapshot();
    expect(next).toMatchObject({
      requests: 0,
      errors4xx: 0,
      errors5xx: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      topRoutes: [],
    });
  });

  it('bounds memory: samples and distinct routes are capped', () => {
    const agg = createAggregator({ maxSamples: 200, maxRoutes: 5 });
    for (let i = 0; i < 20_000; i += 1) {
      agg.record({ status: 200, durationMs: i % 300, route: `/r${i % 50}` });
    }
    expect(agg.sampleCount).toBe(200);
    expect(agg.routeCount).toBe(6); // 5 named + "other"
    const report = agg.snapshot();
    expect(report.requests).toBe(20_000);
    expect(report.topRoutes.length).toBeLessThanOrEqual(10);
    const other = report.topRoutes.find((r) => r.route === OTHER_ROUTE);
    expect(other.requests).toBe(20_000 - 5 * 400);
  });

  it('tolerates odd input without throwing', () => {
    const agg = createAggregator();
    expect(() => agg.record({ status: undefined, durationMs: NaN, route: '' })).not.toThrow();
    expect(agg.snapshot()).toMatchObject({
      requests: 1,
      p50Ms: 0,
      topRoutes: [{ route: 'unmatched' }],
    });
  });
});
