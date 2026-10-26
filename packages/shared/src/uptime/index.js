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
 * Uptime as a percentage with 3 decimals (99.954), or null when there is no
 * data. null is not 100%: "never checked" must not look like "perfect".
 */
export function uptimePercent(upChecks, totalChecks) {
  if (!totalChecks) return null;
  return Math.round((upChecks / totalChecks) * 100_000) / 1000;
}

/**
 * Combines daily rollups into one figure. Weighted by number of checks, NOT an
 * average of daily percentages (a day with 10 checks mustn't count as much as
 * a day with 8,640).
 */
export function combineRollups(rollups) {
  const totals = rollups.reduce(
    (acc, r) => ({
      totalChecks: acc.totalChecks + (r.totalChecks ?? 0),
      upChecks: acc.upChecks + (r.upChecks ?? 0),
      downtimeSec: acc.downtimeSec + (r.downtimeSec ?? 0),
    }),
    { totalChecks: 0, upChecks: 0, downtimeSec: 0 },
  );
  return { ...totals, uptime: uptimePercent(totals.upChecks, totals.totalChecks) };
}

/**
 * One entry per day for the last `days` days (oldest first, today last), so
 * the 90-day bar chart always has 90 bars. Days without a rollup get
 * `uptime: null` ("no data"), drawn grey rather than green.
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
        avgResponseMs: null,
        p95ResponseMs: null,
      };
    }
    return {
      date,
      totalChecks: r.totalChecks,
      upChecks: r.upChecks,
      uptime: uptimePercent(r.upChecks, r.totalChecks),
      downtimeSec: r.downtimeSec ?? 0,
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

/** Colour band for an uptime figure; shared by chips, bars and the status page. */
export function uptimeLevel(uptime) {
  if (uptime == null) return 'none';
  if (uptime >= 99.9) return 'good';
  if (uptime >= 99) return 'degraded';
  return 'bad';
}
