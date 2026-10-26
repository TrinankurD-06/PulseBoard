import { describe, expect, it } from 'vitest';
import {
  bucketSizeMs,
  combineRollups,
  dayKey,
  downtimeWithin,
  fillDailySeries,
  uptimeLevel,
  uptimePercent,
  utcDayStart,
} from '../src/uptime/index.js';

describe('uptimePercent', () => {
  it('returns a percentage with 3 decimals', () => {
    expect(uptimePercent(8640, 8640)).toBe(100);
    expect(uptimePercent(8636, 8640)).toBe(99.954);
    expect(uptimePercent(1, 3)).toBe(33.333);
  });

  it('returns null (not 100) when there is no data', () => {
    expect(uptimePercent(0, 0)).toBeNull();
  });
});

describe('combineRollups', () => {
  it('weights by number of checks, not by averaging daily percentages', () => {
    const result = combineRollups([
      { totalChecks: 8640, upChecks: 8640, downtimeSec: 0 }, // a full day at 100%
      { totalChecks: 10, upChecks: 0, downtimeSec: 600 }, // a tiny day at 0%
    ]);
    // Averaging percentages would give 50%; weighting gives ~99.88%.
    expect(result).toEqual({
      totalChecks: 8650,
      upChecks: 8640,
      downtimeSec: 600,
      uptime: 99.884,
    });
  });

  it('handles an empty list', () => {
    expect(combineRollups([]).uptime).toBeNull();
  });
});

describe('fillDailySeries', () => {
  const today = new Date('2026-03-10T15:00:00Z');

  it('returns exactly N days, oldest first, ending today', () => {
    const series = fillDailySeries([], { days: 90, today });
    expect(series).toHaveLength(90);
    expect(series[0].date).toBe('2025-12-11');
    expect(series.at(-1).date).toBe('2026-03-10');
    expect(series.every((d) => d.uptime === null)).toBe(true);
  });

  it('places rollups on their day and computes uptime', () => {
    const series = fillDailySeries(
      [
        { date: new Date('2026-03-09T00:00:00Z'), totalChecks: 100, upChecks: 99, downtimeSec: 30 },
        { date: new Date('2026-03-10T00:00:00Z'), totalChecks: 50, upChecks: 50 },
      ],
      { days: 3, today },
    );
    expect(series.map((d) => [d.date, d.uptime, d.downtimeSec])).toEqual([
      ['2026-03-08', null, 0],
      ['2026-03-09', 99, 30],
      ['2026-03-10', 100, 0],
    ]);
  });
});

describe('time helpers', () => {
  it('utcDayStart and dayKey use UTC', () => {
    expect(utcDayStart('2026-03-10T23:59:59Z').toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(dayKey(new Date('2026-03-10T05:00:00Z'))).toBe('2026-03-10');
  });

  it('bucketSizeMs keeps at most maxPoints buckets, in whole seconds', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(bucketSizeMs(day, 500)).toBe(173_000); // 172.8 s rounded up
    expect(Math.ceil(day / bucketSizeMs(day, 500))).toBeLessThanOrEqual(500);
    expect(bucketSizeMs(10_000, 500)).toBe(1000); // never below 1 s
  });
});

describe('downtimeWithin', () => {
  const start = new Date('2026-03-10T00:00:00Z');
  const end = new Date('2026-03-11T00:00:00Z');
  const at = (time) => new Date(`2026-03-10T${time}Z`);

  it('sums only the overlap of each incident with the window', () => {
    const incidents = [
      { startedAt: new Date('2026-03-09T23:50:00Z'), resolvedAt: at('00:10:00') }, // 10 min inside
      { startedAt: at('12:00:00'), resolvedAt: at('12:00:30') }, // 30 s
      { startedAt: new Date('2026-03-11T01:00:00Z'), resolvedAt: new Date('2026-03-11T02:00:00Z') }, // outside
    ];
    expect(downtimeWithin(incidents, start, end)).toBe(630);
  });

  it('counts an open incident until now', () => {
    const incidents = [{ startedAt: at('10:00:00'), resolvedAt: null }];
    expect(downtimeWithin(incidents, start, end, at('10:05:00'))).toBe(300);
  });
});

describe('uptimeLevel', () => {
  it('bands uptime for colouring', () => {
    expect(uptimeLevel(null)).toBe('none');
    expect(uptimeLevel(99.95)).toBe('good');
    expect(uptimeLevel(99.5)).toBe('degraded');
    expect(uptimeLevel(97)).toBe('bad');
  });
});
