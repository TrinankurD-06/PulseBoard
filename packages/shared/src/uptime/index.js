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
 * Truncates (never rounds) `value` to `decimals` places. A tiny epsilon keeps
 * values like 98.95 that float maths stores as 98.9499999 from losing a digit.
 */
export function truncateTo(value, decimals) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-7) / factor;
}

/**
 * Uptime = 100 x (1 - downtime / covered time), truncated to 3 decimals. null
 * when nothing was covered: null is not 100%, "never watched" must not look
 * like "perfect". Truncation means a figure is 100 only when downtime is
 * exactly 0, never because it rounded up. Downtime is clamped to [0, coveredSec].
 */
export function uptimeFromDowntime(downtimeSec, coveredSec) {
  if (!(coveredSec > 0)) return null;
  const downtime = Math.min(Math.max(Number(downtimeSec) || 0, 0), coveredSec);
  if (downtime === 0) return 100;
  // Below 100 even when the share is tiny: 1 s in 90 days is 99.999, not 100.
  return Math.min(truncateTo((1 - downtime / coveredSec) * 100, 3), 99.999);
}

/** The text of an uptime figure, used by every surface: "100", "99.96" (2 decimals, truncated) or "—". */
export function formatUptime(uptime) {
  if (uptime == null || !Number.isFinite(uptime)) return '—';
  if (uptime >= 100) return '100';
  return truncateTo(Math.min(uptime, 99.99), 2).toFixed(2);
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
 * Combined uptime of the last `days` days: the final rollups of past days plus
 * today computed live (`todayLive` = computeUptimeFromParts for today so far,
 * or null), so the figure never lags the 15-minute rollup refresh.
 */
export function combineWithToday(rollups, todayLive, { days, today }) {
  const dayStart = utcDayStart(today);
  const past = rollups.filter((r) => r.date < dayStart && r.date >= addDays(dayStart, 1 - days));
  const parts = combineRollups(past);
  const downtimeSec = parts.downtimeSec + (todayLive?.downtimeSec ?? 0);
  const coveredSec = parts.coveredSec + (todayLive?.coveredSec ?? 0);
  return { downtimeSec, coveredSec, uptime: uptimeFromDowntime(downtimeSec, coveredSec) };
}

/** Replaces the last entry (today) of a fillDailySeries result with the live figures. */
export function withLiveToday(series, todayLive) {
  if (!todayLive || !series.length) return series;
  const last = series[series.length - 1];
  return [
    ...series.slice(0, -1),
    {
      ...last,
      uptime: todayLive.uptime,
      downtimeSec: todayLive.downtimeSec,
      coveredSec: todayLive.coveredSec,
    },
  ];
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

/** Sorted, non-overlapping [start, end] ms intervals; empty and inverted ones are dropped. */
export function mergeIntervals(intervals) {
  const sorted = intervals
    .map(([start, end]) => [Number(start), Number(end)])
    .filter(([start, end]) => end > start)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** The parts of [start, end] that no excluded interval touches. */
function subtractIntervals(start, end, excluded) {
  const kept = [];
  let cursor = start;
  for (const [from, to] of mergeIntervals(excluded)) {
    if (to <= cursor) continue;
    if (from >= end) break;
    if (from > cursor) kept.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) kept.push([cursor, end]);
  return kept;
}

const toMs = (value) => new Date(value).getTime();

/**
 * THE uptime formula, shared by every surface (gauge, Uptime card and its
 * sparkline, 90-day bars, status pages, rollups, metrics endpoint):
 *
 *   uptime = 1 - confirmed incident downtime / watched time
 *
 * over the window [from, to). Watched time runs from the later of `from` and
 * `watchStart` (when we began watching) to the earlier of `to` and `now`,
 * minus every `exclusions` interval (paused time, and time the checker itself
 * was offline). Only incident time inside watched time counts as downtime. No
 * watched time gives uptime null. Open incidents count until `now`.
 * Intervals are [startMs, endMs] pairs.
 */
export function computeUptimeFromParts({
  incidents,
  from,
  to,
  now = new Date(),
  watchStart = null,
  exclusions = [],
}) {
  const start = Math.max(toMs(from), watchStart ? toMs(watchStart) : -Infinity);
  const end = Math.min(toMs(to), toMs(now));
  const watched = end > start ? subtractIntervals(start, end, exclusions) : [];
  const coveredMs = watched.reduce((sum, [a, b]) => sum + (b - a), 0);
  const coveredSec = Math.round(coveredMs / 1000);

  let downMs = 0;
  if (coveredMs > 0) {
    const spans = mergeIntervals(
      (incidents ?? []).map((i) => [toMs(i.startedAt), toMs(i.resolvedAt ?? now)]),
    );
    for (const [a, b] of watched) {
      for (const [from2, to2] of spans) {
        const overlap = Math.min(b, to2) - Math.max(a, from2);
        if (overlap > 0) downMs += overlap;
      }
    }
  }
  const downtimeSec = Math.round(downMs / 1000);
  return { uptime: uptimeFromDowntime(downtimeSec, coveredSec), downtimeSec, coveredSec };
}

/** Same as computeUptimeFromParts; kept for callers without exclusions. */
export const windowUptime = computeUptimeFromParts;

/** Colour band for an uptime figure; shared by chips, bars and the status page. */
export function uptimeLevel(uptime) {
  if (uptime == null) return 'none';
  if (uptime >= 99.9) return 'good';
  if (uptime >= 99) return 'degraded';
  return 'bad';
}
