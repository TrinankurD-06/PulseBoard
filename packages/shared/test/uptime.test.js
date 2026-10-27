import { describe, expect, it } from 'vitest';
import {
  bucketSizeMs,
  combineRollups,
  dayKey,
  downtimeWithin,
  fillDailySeries,
  rollupCoveredSec,
  uptimeFromDowntime,
  uptimeLevel,
  uptimePercent,
  utcDayStart,
  windowUptime,
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

describe('uptimeFromDowntime', () => {
  it('is 100 x (1 - downtime / covered)', () => {
    expect(uptimeFromDowntime(0, 86400)).toBe(100);
    expect(uptimeFromDowntime(864, 86400)).toBe(99);
    expect(uptimeFromDowntime(86400, 86400)).toBe(0);
  });

  it('an incident of N seconds in a day lowers uptime by N/86400', () => {
    expect(uptimeFromDowntime(90, 86400)).toBe(99.896);
  });

  it('is null when nothing was covered', () => {
    expect(uptimeFromDowntime(0, 0)).toBeNull();
    expect(uptimeFromDowntime(10, null)).toBeNull();
    expect(uptimeFromDowntime(10, -5)).toBeNull();
  });

  it('clamps downtime to [0, covered]', () => {
    expect(uptimeFromDowntime(-50, 100)).toBe(100);
    expect(uptimeFromDowntime(500, 100)).toBe(0);
  });
});

describe('rollupCoveredSec', () => {
  it('uses the stored coveredSec', () => {
    expect(rollupCoveredSec({ coveredSec: 3600, isFinal: true, totalChecks: 5 })).toBe(3600);
  });

  it('legacy rows: a full day when final with checks, else null', () => {
    expect(rollupCoveredSec({ isFinal: true, totalChecks: 5 })).toBe(86400);
    expect(rollupCoveredSec({ isFinal: true, totalChecks: 0 })).toBeNull();
    expect(rollupCoveredSec({ isFinal: false, totalChecks: 5 })).toBeNull();
    expect(rollupCoveredSec({ coveredSec: null, isFinal: false, totalChecks: 5 })).toBeNull();
  });
});

describe('combineRollups', () => {
  it('uptime is total downtime over total covered time', () => {
    const result = combineRollups([
      { totalChecks: 8640, upChecks: 8640, downtimeSec: 0, coveredSec: 86400 },
      { totalChecks: 10, upChecks: 0, downtimeSec: 600, coveredSec: 3600 }, // partial first day
    ]);
    expect(result).toEqual({
      totalChecks: 8650,
      upChecks: 8640,
      downtimeSec: 600,
      coveredSec: 90000,
      uptime: 99.333,
    });
  });

  it('failed checks that never opened an incident do not reduce uptime', () => {
    const result = combineRollups([
      { totalChecks: 100, upChecks: 90, downtimeSec: 0, coveredSec: 86400 },
    ]);
    expect(result.uptime).toBe(100);
  });

  it('legacy final rows count as a full day; rows with unknown coverage are skipped', () => {
    const result = combineRollups([
      { totalChecks: 10, upChecks: 10, downtimeSec: 864, isFinal: true },
      { totalChecks: 4, upChecks: 4, downtimeSec: 0, isFinal: false },
    ]);
    expect(result).toMatchObject({ totalChecks: 14, coveredSec: 86400, uptime: 99 });
  });

  it('is null with no coverage', () => {
    expect(combineRollups([]).uptime).toBeNull();
    expect(combineRollups([{ totalChecks: 3, upChecks: 3, isFinal: false }]).uptime).toBeNull();
  });
});

describe('fillDailySeries', () => {
  const today = new Date('2026-03-10T15:00:00Z');

  it('returns exactly N days, oldest first, ending today', () => {
    const series = fillDailySeries([], { days: 90, today });
    expect(series).toHaveLength(90);
    expect(series[0].date).toBe('2025-12-11');
    expect(series.at(-1).date).toBe('2026-03-10');
    expect(series.every((d) => d.uptime === null && d.sample === false)).toBe(true);
  });

  it('places rollups on their day and computes uptime from downtime', () => {
    const series = fillDailySeries(
      [
        {
          date: new Date('2026-03-09T00:00:00Z'),
          totalChecks: 100,
          upChecks: 60,
          downtimeSec: 864,
          coveredSec: 86400,
          isSeed: true,
        },
        {
          date: new Date('2026-03-10T00:00:00Z'),
          totalChecks: 50,
          upChecks: 50,
          coveredSec: 54000,
        },
      ],
      { days: 3, today },
    );
    expect(series.map((d) => [d.date, d.uptime, d.downtimeSec, d.coveredSec, d.sample])).toEqual([
      ['2026-03-08', null, 0, null, false],
      ['2026-03-09', 99, 864, 86400, true],
      ['2026-03-10', 100, 0, 54000, false],
    ]);
  });

  it('a legacy row without coveredSec uses a full day when final', () => {
    const [row] = fillDailySeries(
      [{ date: new Date('2026-03-10T00:00:00Z'), totalChecks: 5, upChecks: 5, isFinal: true }],
      { days: 1, today },
    );
    expect(row).toMatchObject({ uptime: 100, coveredSec: 86400 });
  });
});

describe('windowUptime', () => {
  const at = (time, day = '10') => new Date(`2026-03-${day}T${time}Z`);

  it('covers the whole window and subtracts incident time', () => {
    const incidents = [{ startedAt: at('10:00:00'), resolvedAt: at('10:36:00') }]; // 2160 s
    const result = windowUptime({
      incidents,
      from: at('00:00:00'),
      to: at('00:00:00', '11'),
      now: at('12:00:00', '11'),
    });
    expect(result).toEqual({ uptime: 97.5, downtimeSec: 2160, coveredSec: 86400 });
  });

  it('covers only up to now and from watchStart', () => {
    const result = windowUptime({
      incidents: [],
      from: at('00:00:00'),
      to: at('00:00:00', '11'),
      now: at('06:00:00'),
      watchStart: at('04:00:00'),
    });
    expect(result).toEqual({ uptime: 100, downtimeSec: 0, coveredSec: 7200 });
  });

  it('counts an open incident until now and handles day boundaries', () => {
    const incidents = [
      { startedAt: at('23:00:00', '09'), resolvedAt: at('01:00:00') }, // 1 h inside the window
      { startedAt: at('05:00:00'), resolvedAt: null },
    ];
    const result = windowUptime({
      incidents,
      from: at('00:00:00'),
      to: at('00:00:00', '11'),
      now: at('06:00:00'),
    });
    expect(result.downtimeSec).toBe(3600 + 3600);
    expect(result.coveredSec).toBe(21600);
    expect(result.uptime).toBe(66.667);
  });

  it('is null when the window has no coverage', () => {
    expect(
      windowUptime({
        incidents: [],
        from: at('00:00:00'),
        to: at('06:00:00'),
        now: at('12:00:00'),
        watchStart: at('08:00:00'),
      }),
    ).toEqual({ uptime: null, downtimeSec: 0, coveredSec: 0 });
    expect(
      windowUptime({ incidents: [], from: at('10:00:00'), to: at('11:00:00'), now: at('09:00:00') })
        .uptime,
    ).toBeNull();
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
