import { describe, expect, it } from 'vitest';
import {
  costOf,
  estimateMonthlyCost,
  estimateMonthlyRequests,
  estimateRequestsBetween,
  monthKey,
  monthStart,
  SECONDS_PER_MONTH,
} from '../src/cost/index.js';

describe('cost estimator', () => {
  it('counts a 30-day month: 1 check per minute = 43,200 requests', () => {
    expect(SECONDS_PER_MONTH).toBe(2_592_000);
    expect(estimateMonthlyRequests({ intervalSec: 60 })).toBe(43_200);
    expect(estimateMonthlyRequests({ intervalSec: 30 })).toBe(86_400);
    expect(estimateMonthlyRequests({ intervalSec: 600 })).toBe(4_320);
  });

  it('treats monitors without a type as http (not yet migrated)', () => {
    expect(estimateMonthlyRequests({ type: 'http', intervalSec: 60 })).toBe(
      estimateMonthlyRequests({ intervalSec: 60 }),
    );
  });

  it('sends no requests for push monitors', () => {
    expect(estimateMonthlyRequests({ type: 'heartbeat', intervalSec: 60 })).toBe(0);
    expect(estimateMonthlyRequests({ type: 'agent', intervalSec: 60 })).toBe(0);
  });

  it('handles missing or invalid intervals (e.g. while typing in the form)', () => {
    expect(estimateMonthlyRequests({ intervalSec: '' })).toBe(0);
    expect(estimateMonthlyRequests({ intervalSec: 0 })).toBe(0);
    expect(estimateMonthlyRequests({ intervalSec: '60' })).toBe(43_200);
  });

  it('estimates requests between two dates', () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-01T01:00:00Z');
    expect(estimateRequestsBetween({ intervalSec: 60 }, from, to)).toBe(60);
    expect(estimateRequestsBetween({ intervalSec: 60 }, to, from)).toBe(0);
  });

  it('prices requests at the customer price per 1,000, rounded to 2 decimals', () => {
    const monitor = { intervalSec: 60, costPer1kRequests: 0.5 };
    expect(costOf(monitor, 1234)).toBe(0.62);
    expect(estimateMonthlyCost(monitor)).toBe(21.6);
    expect(estimateMonthlyCost({ intervalSec: 60, costPer1kRequests: 0 })).toBe(0);
  });

  it('returns null cost when no price is set', () => {
    expect(estimateMonthlyCost({ intervalSec: 60 })).toBeNull();
    expect(estimateMonthlyCost({ intervalSec: 60, costPer1kRequests: null })).toBeNull();
    expect(costOf({ costPer1kRequests: '' }, 1000)).toBeNull();
  });
});

describe('month helpers', () => {
  it('use UTC calendar months', () => {
    expect(monthKey(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(monthKey(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
    expect(monthStart(new Date('2026-10-17T12:00:00Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });
});
