// Uptime and time-series maths as pure functions (browser-safe), so the API,
// the worker and the charts all compute the same numbers.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the day containing `date`. Rollups are keyed by this. */
export function utcDayStart(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);

/** "2026-01-31" for a UTC day. */
export const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * Share of checks that passed, with 3 decimals (99.954), or null when there
 * are none. This is a PASS RATE, not uptime: uptime comes from confirmed
 * downtime only (uptimeFromDowntime), so failed checks that never opened an
 * incident do not lower it.
 */
export function uptimePercent(upChecks, totalChecks) {
  if (!totalChecks) return null;
  return Math.round((upChecks / totalChecks) * 100_000) / 1000;
}

/**
 * Uptime = 100 x (1 - downtime / covered time), 3 decimals. null when nothing
 * was covered: null is not 100%, "never watched" must not look like "perfect".
 * Downtime is clamped to [0, coveredSec].
 */
export function uptimeFromDowntime(downtimeSec, coveredSec) {
  if (!(coveredSec > 0)) return null;
  const downtime = Math.min(Math.max(Number(downtimeSec) || 0, 0), coveredSec);
  return Math.round((1 - downtime / coveredSec) * 100_000) / 1000;
}

/**
 * Seconds a rollup covers: its stored coveredSec, or for legacy rows without
 * one a full day when the row is final and has checks; otherwise null.
 */
export function rollupCoveredSec(rollup) {
  if (typeof rollup?.coveredSec === 'number' && rollup.coveredSec > 0) return rollup.coveredSec;
  if (rollup?.isFinal && rollup.totalChecks > 0) return DAY_MS / 1000;
  return null;
}

/**
 * Combines daily rollups into one figure. Uptime is total downtime over total
 * covered time; rows with unknown coverage are skipped for uptime but still
 * summed for the check counts.
 */
export function combineRollups(rollups) {
  const totals = { totalChecks: 0, upChecks: 0, downtimeSec: 0, coveredSec: 0 };
  for (const r of rollups) {
    totals.totalChecks += r.totalChecks ?? 0;
    totals.upChecks += r.upChecks ?? 0;
    const covered = rollupCoveredSec(r);
    if (covered == null) continue;
    totals.coveredSec += covered;
    totals.downtimeSec += Math.min(Math.max(r.downtimeSec ?? 0, 0), covered);
  }
  return { ...totals, uptime: uptimeFromDowntime(totals.downtimeSec, totals.coveredSec) };
}

/**
 * One entry per day for the last `days` days (oldest first, today last), so
 * the 90-day bar chart always has 90 bars. Days without a rollup get
 * `uptime: null` ("no data"), drawn grey rather than green. `sample` is true
 * for rollups created by the demo seed.
 */
export function fillDailySeries(rollups, { days, today = new Date() }) {
  const byDay = new Map(rollups.map((r) => [dayKey(r.date), r]));
  const lastDay = utcDayStart(today);
  return Array.from({ length: days }, (_, i) => {
    const date = dayKey(addDays(lastDay, i - (days - 1)));
    const r = byDay.get(date);
    if (!r) {
      return {
        date,
        totalChecks: 0,
        upChecks: 0,
        uptime: null,
        downtimeSec: 0,
        coveredSec: null,
        sample: false,
        avgResponseMs: null,
        p95ResponseMs: null,
      };
    }
    const coveredSec = rollupCoveredSec(r);
    return {
      date,
      totalChecks: r.totalChecks,
      upChecks: r.upChecks,
      uptime: uptimeFromDowntime(r.downtimeSec ?? 0, coveredSec),
      downtimeSec: r.downtimeSec ?? 0,
      coveredSec,
      sample: Boolean(r.isSeed),
      avgResponseMs: r.avgResponseMs ?? null,
      p95ResponseMs: r.p95ResponseMs ?? null,
    };
  });
}

/**
 * Bucket width for downsampling a time range to at most `maxPoints` points,
 * rounded up to whole seconds.
 */
export function bucketSizeMs(rangeMs, maxPoints) {
  return Math.max(1000, Math.ceil(rangeMs / maxPoints / 1000) * 1000);
}

/**
 * Seconds of downtime inside [start, end): the overlap of each incident with
 * the window. Open incidents count until `now`.
 */
export function downtimeWithin(incidents, start, end, now = new Date()) {
  const windowStart = new Date(start).getTime();
  const windowEnd = Math.min(new Date(end).getTime(), new Date(now).getTime());
  let totalMs = 0;
  for (const incident of incidents) {
    const from = Math.max(new Date(incident.startedAt).getTime(), windowStart);
    const to = Math.min(new Date(incident.resolvedAt ?? now).getTime(), windowEnd);
    if (to > from) totalMs += to - from;
  }
  return Math.round(totalMs / 1000);
}

/**
 * Uptime of an arbitrary window [from, to) from incidents. Covered time runs
 * from the later of `from` and `watchStart` (when we began watching the
 * monitor) to the earlier of `to` and `now`; no coverage gives uptime null.
 * Open incidents count until `now`.
 */
export function windowUptime({ incidents, from, to, now = new Date(), watchStart = null }) {
  const start = Math.max(
    new Date(from).getTime(),
    watchStart ? new Date(watchStart).getTime() : -Infinity,
  );
  const end = Math.min(new Date(to).getTime(), new Date(now).getTime());
  const coveredSec = Math.max(0, Math.round((end - start) / 1000));
  const downtimeSec =
    coveredSec > 0 ? downtimeWithin(incidents ?? [], new Date(start), new Date(end), now) : 0;
  return { uptime: uptimeFromDowntime(downtimeSec, coveredSec), downtimeSec, coveredSec };
}

/** Colour band for an uptime figure; shared by chips, bars and the status page. */
export function uptimeLevel(uptime) {
  if (uptime == null) return 'none';
  if (uptime >= 99.9) return 'good';
  if (uptime >= 99) return 'degraded';
  return 'bad';
}
