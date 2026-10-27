import { CHECK_STATE, MISSED_PING_PREFIX, MONITOR_TYPES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { AgentReport, CheckResult, Monitor } from '@pulseboard/shared/models';
import { windowUptime } from '@pulseboard/shared/uptime';
import { getIncidentsSince, getWatchStart } from './analytics.service.js';

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

const MAX_FAILURES = 20;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The three ranges of the Health deck: bucket size, bucket count and the
 * matching $dateTrunc unit/binSize (bins align to 2000-01-01T00:00Z, which is
 * epoch-aligned for these sizes, so the JS grid and MongoDB agree).
 */
export const METRIC_RANGES = Object.freeze({
  '1h': { bucketMs: MINUTE_MS, count: 60, unit: 'minute', binSize: 1 },
  '24h': { bucketMs: 15 * MINUTE_MS, count: 96, unit: 'minute', binSize: 15 },
  '7d': { bucketMs: 2 * HOUR_MS, count: 84, unit: 'hour', binSize: 2 },
});

// ---------------------------------------------------------------------------
// Pure helpers (no database): grid math and response assembly.
// ---------------------------------------------------------------------------

/**
 * The bucket grid for a range at `now`. The last bucket is the one containing
 * now (partial). Current window = [from, now], previous = [prevFrom, from).
 */
export function bucketGrid(range, now = new Date()) {
  const { bucketMs, count } = METRIC_RANGES[range];
  const lastStart = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const from = lastStart - (count - 1) * bucketMs;
  return {
    range,
    bucketMs,
    count,
    from: new Date(from),
    prevFrom: new Date(from - count * bucketMs),
    now,
    starts: Array.from({ length: count }, (_, i) => new Date(from + i * bucketMs)),
  };
}

export function roundTo(value, decimals) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** (value - previous) / |previous| * 100 with one decimal; null without both or when previous is 0. */
export function changePercent(value, previous) {
  if (value == null || previous == null || previous === 0) return null;
  return roundTo(((value - previous) / Math.abs(previous)) * 100, 1);
}

/** current / peak / low / average of a series, ignoring gaps (all null when there is no data). */
export function summarizeSeries(values) {
  const present = values.filter((v) => v != null);
  if (!present.length) return { current: null, peak: null, average: null, low: null };
  return {
    current: present[present.length - 1],
    peak: Math.max(...present),
    average: present.reduce((sum, v) => sum + v, 0) / present.length,
    low: Math.min(...present),
  };
}

/**
 * One metric of the response. `at(doc, seconds)` turns an aggregated document
 * (a bucket, the current window or the previous window) into a number or null;
 * `seconds` is the span the document covers, for rates.
 */
export function buildMetric({
  key,
  label,
  unit,
  decimals,
  grid,
  buckets,
  current,
  previous,
  at,
  offline = new Set(),
}) {
  const bucketSec = grid.bucketMs / 1000;
  // A bucket of nothing but unknown results (checker offline) is a gap, never a value.
  const raw = grid.starts.map((start) => {
    const doc = buckets.get(start.getTime());
    return doc && !offline.has(start.getTime()) ? at(doc, bucketSec) : null;
  });
  const windowSec = (grid.now - grid.from) / 1000;
  const value = current ? at(current, windowSec) : null;
  const before = previous ? at(previous, (grid.count * grid.bucketMs) / 1000) : null;
  const summary = summarizeSeries(raw);
  const round = (v) => roundTo(v, decimals);
  return {
    key,
    label,
    unit,
    value: round(value),
    previous: round(before),
    change: changePercent(value, before),
    current: round(summary.current),
    peak: round(summary.peak),
    average: round(summary.average),
    low: round(summary.low),
    series: grid.starts.map((start, i) => ({
      t: start.toISOString(),
      v: round(raw[i]),
      ...(offline.has(start.getTime()) && { offline: true }),
    })),
  };
}

/** Buckets whose results were all unknown (the checker was offline): n counts known results only. */
export function offlineBuckets(buckets) {
  return new Set(
    [...buckets].filter(([, doc]) => !doc.n && doc.unknown > 0).map(([start]) => start),
  );
}

/**
 * Uptime documents for buildMetric, from incidents (confirmed downtime) over
 * the time we were watching: one per bucket, the current window and the
 * previous one. A window nothing was watched in has no document (null).
 */
export function buildUptimeParts(grid, { incidents, watchStart, offline }) {
  const of = (from, to) => {
    if (!watchStart) return null; // never recorded anything: no figures
    const { uptime } = windowUptime({ incidents, from, to, now: grid.now, watchStart });
    return uptime == null ? null : { uptime };
  };
  const buckets = new Map();
  for (const start of grid.starts) {
    const doc = of(start, new Date(start.getTime() + grid.bucketMs));
    if (doc) buckets.set(start.getTime(), doc);
  }
  return {
    buckets,
    current: of(grid.from, grid.now),
    previous: of(grid.prevFrom, grid.from),
    offline,
  };
}

const ratio = (part, whole) => (whole ? (part / whole) * 100 : null);
const mean = (sum, n) => (n ? sum / n : null);

/** Metric definitions per document shape: [key, label, unit, decimals, at]. */
export const HTTP_METRICS = [
  ['uptime', 'Uptime', '%', 2, (d) => d.uptime ?? null],
  ['p95', 'p95 response', 'ms', 0, (d) => d.p95?.[0] ?? null],
  ['failed', 'Failed checks', '%', 2, (d) => ratio(d.n - d.ok, d.n)],
  ['avgResponse', 'Avg response', 'ms', 0, (d) => mean(d.sumMs, d.nMs)],
];

export const HEARTBEAT_METRICS = [
  ['uptime', 'Uptime', '%', 2, (d) => d.uptime ?? null],
  ['missed', 'Missed pings', 'pings', 0, (d) => (d.n ? d.missed : null)],
  // Lateness documents are built in JS from the per-bucket sums.
  ['lateness', 'Avg lateness', 'ms', 0, (d) => mean(d.lateSum, d.lateN)],
  ['duration', 'Job duration', 'ms', 0, (d) => mean(d.sumAll, d.nAll)],
];

export const AGENT_METRICS = [
  ['requestRate', 'Request rate', 'req/s', 2, (d, sec) => d.requests / sec],
  ['p95Latency', 'p95 latency', 'ms', 1, (d) => mean(d.weighted, d.weight)],
  ['errorRate', 'Error rate', '%', 2, (d) => ratio(d.errors5xx, d.requests)],
  ['uptime', 'Uptime', '%', 2, (d) => d.uptime ?? null],
];

/** Averages of the timing breakdown per bucket (http only); null fields for empty buckets. */
export function buildTimings(grid, buckets) {
  return grid.starts.map((start) => {
    const doc = buckets.get(start.getTime());
    const field = (name) => (doc ? roundTo(doc[name], 0) : null);
    return {
      t: start.toISOString(),
      ...(doc && !doc.n && doc.unknown > 0 && { offline: true }),
      dnsMs: field('dnsMs'),
      tcpMs: field('tcpMs'),
      tlsMs: field('tlsMs'),
      ttfbMs: field('ttfbMs'),
      downloadMs: field('downloadMs'),
    };
  });
}

/** The live accumulators the client folds new check results into. */
export function buildLive(grid, lastAt, buckets, current) {
  const pick = (doc) => ({
    n: doc?.n ?? 0,
    ok: doc?.ok ?? 0,
    sumMs: doc?.sumMs ?? 0,
    nMs: doc?.nMs ?? 0,
  });
  const lastStart = grid.starts[grid.count - 1];
  return {
    lastAt: lastAt ? new Date(lastAt).toISOString() : null,
    last: { t: lastStart.toISOString(), ...pick(buckets.get(lastStart.getTime())) },
    range: pick(current),
  };
}

/** Assembles `data` from aggregated documents (see getMetrics for where they come from). */
export function assembleMetrics({
  type,
  grid,
  defs,
  parts,
  timings,
  live,
  empty,
  failures = [],
  includesSampleData = false,
}) {
  return {
    type,
    range: grid.range,
    bucketMs: grid.bucketMs,
    from: grid.from.toISOString(),
    to: grid.now.toISOString(),
    empty,
    metrics: defs.map(([key, label, unit, decimals, at]) =>
      buildMetric({ key, label, unit, decimals, grid, at, ...parts(key) }),
    ),
    timings,
    live,
    failures,
    includesSampleData,
  };
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

const missedFilter = new RegExp(`^${MISSED_PING_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

const isMissed = {
  $regexMatch: { input: { $ifNull: ['$error', ''] }, regex: missedFilter.source },
};
const hasMs = { $isNumber: '$totalMs' };
const okWithMs = { $and: ['$ok', hasMs] };
// Older results have no state, so "not unknown" (not "ok or failed") is the test.
const isUnknown = { $eq: ['$state', CHECK_STATE.UNKNOWN] };
const known = { $not: [isUnknown] };
const count = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

/** $group accumulators for check results; `withTimings` adds the per-bucket timing averages. */
function checkAccumulators({ withTimings = false } = {}) {
  const timing = (name) => ({ $avg: { $cond: ['$ok', `$timings.${name}`, null] } });
  return {
    // n counts results the checker could judge; unknown ones (checker offline) are tallied apart.
    n: count(known),
    ok: count('$ok'),
    unknown: count(isUnknown),
    seed: { $max: { $cond: ['$isSeed', 1, 0] } },
    sumMs: { $sum: { $cond: [okWithMs, '$totalMs', 0] } },
    nMs: count(okWithMs),
    // Heartbeat: every ping that carries a duration (a failed timed run too).
    sumAll: { $sum: { $cond: [{ $and: [known, hasMs] }, '$totalMs', 0] } },
    nAll: count({ $and: [known, hasMs] }),
    missed: count({ $and: [known, isMissed] }),
    p95: {
      $percentile: {
        input: { $cond: [okWithMs, '$totalMs', null] },
        p: [0.95],
        method: 'approximate',
      },
    },
    ...(withTimings && {
      dnsMs: timing('dnsMs'),
      tcpMs: timing('tcpMs'),
      tlsMs: timing('tlsMs'),
      ttfbMs: timing('ttfbMs'),
      downloadMs: timing('downloadMs'),
    }),
  };
}

const bucketOf = (field, { unit, binSize }) => ({
  $dateTrunc: { date: field, unit, binSize },
});
const byStart = (docs) => new Map(docs.map(({ _id, ...doc }) => [_id.getTime(), doc]));
const stripId = (docs) => (docs[0] ? { ...docs[0], _id: undefined } : null);

/** Check results of a monitor: current buckets and totals, previous totals, in one $facet. */
async function aggregateChecks(monitorId, grid, { withTimings }) {
  const spec = METRIC_RANGES[grid.range];
  const [result] = await CheckResult.aggregate([
    {
      $match: {
        'meta.monitorId': monitorId,
        timestamp: { $gte: grid.prevFrom, $lte: grid.now },
      },
    },
    {
      $facet: {
        buckets: [
          { $match: { timestamp: { $gte: grid.from } } },
          { $group: { _id: bucketOf('$timestamp', spec), ...checkAccumulators({ withTimings }) } },
        ],
        current: [
          { $match: { timestamp: { $gte: grid.from } } },
          { $group: { _id: null, ...checkAccumulators() } },
        ],
        previous: [
          { $match: { timestamp: { $lt: grid.from } } },
          { $group: { _id: null, ...checkAccumulators() } },
        ],
      },
    },
  ]);
  const buckets = byStart(result.buckets);
  return {
    buckets,
    current: stripId(result.current),
    previous: stripId(result.previous),
    offline: offlineBuckets(buckets),
  };
}

/** The newest failed checks of the current window (unknown ones are not failures), for the error list. */
async function recentFailures(monitorId, grid) {
  const rows = await CheckResult.find(
    {
      'meta.monitorId': monitorId,
      timestamp: { $gte: grid.from, $lte: grid.now },
      ok: false,
      state: { $ne: CHECK_STATE.UNKNOWN },
    },
    { timestamp: 1, errorCode: 1, error: 1 },
  )
    .sort({ timestamp: -1 })
    .limit(MAX_FAILURES)
    .lean();
  return rows.map((row) => ({
    t: row.timestamp.toISOString(),
    code: row.errorCode ?? null,
    message: row.error ?? null,
  }));
}

/**
 * Heartbeat lateness: gap between consecutive pings beyond the expected period.
 * One ping before the previous window is included as predecessor of the first
 * ping, then discarded. Grouped over both windows; the caller splits them.
 */
async function aggregateLateness(monitorId, grid, expectedEverySec) {
  const spec = METRIC_RANGES[grid.range];
  const ping = { 'meta.monitorId': monitorId, error: { $not: missedFilter } };
  const predecessor = await CheckResult.findOne(
    { ...ping, timestamp: { $lt: grid.prevFrom } },
    { timestamp: 1 },
  )
    .sort({ timestamp: -1 })
    .lean();
  const rows = await CheckResult.aggregate([
    {
      $match: {
        ...ping,
        timestamp: { $gte: predecessor?.timestamp ?? grid.prevFrom, $lte: grid.now },
      },
    },
    {
      $setWindowFields: {
        sortBy: { timestamp: 1 },
        output: { previousAt: { $shift: { output: '$timestamp', by: -1 } } },
      },
    },
    { $match: { timestamp: { $gte: grid.prevFrom } } },
    {
      $project: {
        timestamp: 1,
        lateMs: {
          $cond: [
            { $eq: [{ $type: '$previousAt' }, 'date'] },
            {
              $max: [
                0,
                {
                  $subtract: [
                    { $subtract: ['$timestamp', '$previousAt'] },
                    expectedEverySec * 1000,
                  ],
                },
              ],
            },
            null,
          ],
        },
      },
    },
    {
      $group: {
        _id: bucketOf('$timestamp', spec),
        lateSum: { $sum: { $ifNull: ['$lateMs', 0] } },
        lateN: count({ $isNumber: '$lateMs' }),
      },
    },
  ]);

  const buckets = new Map();
  const current = { lateSum: 0, lateN: 0 };
  const previous = { lateSum: 0, lateN: 0 };
  for (const { _id, lateSum, lateN } of rows) {
    const side = _id.getTime() >= grid.from.getTime() ? current : previous;
    side.lateSum += lateSum;
    side.lateN += lateN;
    if (_id.getTime() >= grid.from.getTime() && lateN)
      buckets.set(_id.getTime(), { lateSum, lateN });
  }
  return {
    buckets,
    current: current.lateN ? current : null,
    previous: previous.lateN ? previous : null,
  };
}

// Reports with requests and a p95 count towards the weighted latency.
const withLatency = { $and: [{ $gt: ['$requests', 0] }, { $isNumber: '$p95Ms' }] };

/** Agent reports by windowEnd: request sums and the requests-weighted p95. */
async function aggregateReports(monitorId, grid) {
  const spec = METRIC_RANGES[grid.range];
  const accumulators = {
    reports: { $sum: 1 },
    requests: { $sum: '$requests' },
    errors5xx: { $sum: '$errors5xx' },
    weighted: {
      $sum: { $cond: [withLatency, { $multiply: ['$p95Ms', '$requests'] }, 0] },
    },
    weight: { $sum: { $cond: [withLatency, '$requests', 0] } },
  };
  const [result] = await AgentReport.aggregate([
    {
      $match: {
        'meta.monitorId': monitorId,
        windowEnd: { $gte: grid.prevFrom, $lte: grid.now },
      },
    },
    {
      $facet: {
        buckets: [
          { $match: { windowEnd: { $gte: grid.from } } },
          { $group: { _id: bucketOf('$windowEnd', spec), ...accumulators } },
        ],
        current: [
          { $match: { windowEnd: { $gte: grid.from } } },
          { $group: { _id: null, ...accumulators } },
        ],
        previous: [
          { $match: { windowEnd: { $lt: grid.from } } },
          { $group: { _id: null, ...accumulators } },
        ],
      },
    },
  ]);
  return {
    buckets: byStart(result.buckets),
    current: stripId(result.current),
    previous: stripId(result.previous),
  };
}

/**
 * Metrics for the Health deck: one grid of buckets per metric, the same
 * metrics over the previous window for the change %, and live accumulators.
 * Each collection is read with ONE aggregation bounded by the monitor and the
 * two windows (the time-series indexes apply); empty buckets are null.
 */
export async function getMetrics(monitorId, range, now = new Date()) {
  const id = toObjectId(monitorId);
  const monitor = await Monitor.findById(id, { type: 1, expectedEverySec: 1 }).lean();
  const grid = bucketGrid(range, now);
  const isHttp = monitor.type === MONITOR_TYPES.HTTP;

  const [checks, latest, failures, incidents, watchStart] = await Promise.all([
    aggregateChecks(id, grid, { withTimings: isHttp }),
    CheckResult.findOne({ 'meta.monitorId': id }, { timestamp: 1 }).sort({ timestamp: -1 }).lean(),
    recentFailures(id, grid),
    getIncidentsSince(id, grid.prevFrom, now),
    getWatchStart(id),
  ]);
  const live = buildLive(grid, latest?.timestamp, checks.buckets, checks.current);
  // Unknown results are not data: a window of only those has no figures (but is not "empty" history).
  const hasChecks = Boolean(checks.current || checks.previous);
  const includesSampleData =
    Boolean(checks.current?.seed || checks.previous?.seed) || incidents.some((i) => i.isSeed);
  // Uptime is confirmed downtime (incidents) over the time we were watching, never check pass rates.
  const uptime = buildUptimeParts(grid, { incidents, watchStart, offline: checks.offline });
  const common = { type: monitor.type, grid, live, failures, includesSampleData };

  if (monitor.type === MONITOR_TYPES.HEARTBEAT) {
    const late = await aggregateLateness(id, grid, monitor.expectedEverySec);
    const parts = (key) => (key === 'lateness' ? late : key === 'uptime' ? uptime : checks);
    return assembleMetrics({
      ...common,
      defs: HEARTBEAT_METRICS,
      parts,
      timings: null,
      empty: !hasChecks,
    });
  }

  if (monitor.type === MONITOR_TYPES.AGENT) {
    const reports = await aggregateReports(id, grid);
    const parts = (key) => (key === 'uptime' ? uptime : reports);
    return assembleMetrics({
      ...common,
      defs: AGENT_METRICS,
      parts,
      timings: null,
      empty: !hasChecks && !(reports.current || reports.previous),
    });
  }

  return assembleMetrics({
    ...common,
    defs: HTTP_METRICS,
    parts: (key) => (key === 'uptime' ? uptime : checks),
    timings: buildTimings(grid, checks.buckets),
    empty: !hasChecks,
  });
}
