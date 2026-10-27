import { budgetState, effectiveIntervalSec, isBudgetSlowed } from '@pulseboard/shared/adaptive';
import { errorRateOf } from '@pulseboard/shared/agent';
import { CHECK_STATE, DEFAULT_CURRENCY } from '@pulseboard/shared/constants';
import {
  costOf,
  estimateMonthlyCost,
  estimateMonthlyRequests,
  estimateRequestsSaved,
  estimateRequestsBetween,
  monthKey,
  monthStart,
} from '@pulseboard/shared/cost';
import { mongoose } from '@pulseboard/shared/db';
import {
  AgentReport,
  CheckResult,
  DailyRollup,
  Incident,
  Monitor,
} from '@pulseboard/shared/models';
import { pingsThisMonth, reportsThisMonth, requestsThisMonth } from '@pulseboard/shared/usage';
import {
  addDays,
  bucketSizeMs,
  combineRollups,
  DAY_MS,
  fillDailySeries,
  uptimeFromDowntime,
  utcDayStart,
  windowUptime,
} from '@pulseboard/shared/uptime';

export const MAX_CHART_POINTS = 500;

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Requests actually sent to the monitor's endpoint this calendar month (UTC,
 * from MonitorUsage) next to what the estimator expected, plus costs at the
 * customer's own price (null when no price is set).
 * "Expected so far" starts at the later of the month start and the monitor's
 * creation, so a monitor created mid-month isn't compared with a full month.
 */
export async function getUsage(monitorId, now = new Date()) {
  const monitor = await Monitor.findById(monitorId).lean();
  const requests = await requestsThisMonth(monitor._id, now);
  const from = new Date(Math.max(monthStart(now).getTime(), new Date(monitor.createdAt).getTime()));
  return {
    month: monthKey(now),
    requests,
    estimatedSoFar: estimateRequestsBetween(monitor, from, now),
    estimatedMonthly: estimateMonthlyRequests(monitor),
    costPer1kRequests: monitor.costPer1kRequests ?? null,
    // lean() skips schema defaults, so a not-yet-migrated monitor may lack it.
    currency: monitor.currency ?? DEFAULT_CURRENCY,
    actualCost: costOf(monitor, requests),
    estimatedMonthlyCost: estimateMonthlyCost(monitor),
    method: monitor.method,
    headUnsupported: Boolean(monitor.headUnsupported),
    budget: {
      monthlyRequestBudget: monitor.monthlyRequestBudget ?? null,
      budgetAction: monitor.budgetAction ?? 'slow',
      usedRatio: monitor.monthlyRequestBudget
        ? Math.round((requests / monitor.monthlyRequestBudget) * 1000) / 1000
        : null,
      state: budgetState(requests, monitor.monthlyRequestBudget),
      exceededThisMonth: monitor.budgetExceededMonth === monthKey(now),
    },
    // Heartbeat pings received this month (requests that came to us, not from us).
    pings: await pingsThisMonth(monitor._id, now),
    // Agent reports received this month (U4), and requests a month not sent
    // compared with polling every minute.
    reports: await reportsThisMonth(monitor._id, now),
    requestsSaved: estimateRequestsSaved(monitor),
    interval: {
      adaptive: Boolean(monitor.adaptive),
      intervalSec: monitor.intervalSec,
      currentIntervalSec: effectiveIntervalSec(monitor),
      minIntervalSec: monitor.minIntervalSec ?? null,
      maxIntervalSec: monitor.maxIntervalSec ?? null,
      slowedByBudget: isBudgetSlowed(monitor, now),
    },
  };
}

/**
 * When we started watching a monitor: its first stored result (raw results
 * live 7 days, so for an old monitor this is about a week ago, which is the
 * widest window computed from raw data). If no raw result is left, the
 * earliest daily rollup. null when there is neither: a monitor that has
 * produced nothing yet has no uptime to report ("no data", not 100%), which is
 * why the monitor's creation time is not used.
 */
export async function getWatchStart(monitorId) {
  const id = toObjectId(monitorId);
  const first = await CheckResult.findOne({ 'meta.monitorId': id }, { timestamp: 1 })
    .sort({ timestamp: 1 })
    .lean();
  if (first) return new Date(first.timestamp);
  const rollup = await DailyRollup.findOne({ monitorId: id }, { date: 1 }).sort({ date: 1 }).lean();
  return rollup ? new Date(rollup.date) : null;
}

/** Incidents of a monitor that overlap [from, now): what uptime windows are computed from. */
export const getIncidentsSince = (monitorId, from, now) =>
  Incident.find(
    {
      monitorId: toObjectId(monitorId),
      startedAt: { $lt: now },
      $or: [{ resolvedAt: null }, { resolvedAt: { $gt: from } }],
    },
    { startedAt: 1, resolvedAt: 1, isSeed: 1 },
  ).lean();

/** The rollup fields uptime needs (coveredSec and isFinal decide the covered time). */
const UPTIME_FIELDS = {
  monitorId: 1,
  date: 1,
  totalChecks: 1,
  upChecks: 1,
  downtimeSec: 1,
  coveredSec: 1,
  isFinal: 1,
  isSeed: 1,
};

/**
 * Uptime % for the four windows shown on the monitor page, from confirmed
 * downtime (incidents) over the time we were watching: a failed check that
 * never opened an incident changes nothing.
 * 24h and 7d are computed from incidents directly (exact, open incidents count
 * up to now); 30/90 days come from daily rollups, because raw checks are only
 * kept for 7 days. Today's rollup is refreshed every 15 minutes.
 * `includesSampleData` is true when any rollup or incident used is seed data.
 */
export async function getUptime(monitorId, now = new Date()) {
  const id = toObjectId(monitorId);
  const today = utcDayStart(now);
  const [rollups, incidents, watchStart] = await Promise.all([
    DailyRollup.find({ monitorId: id, date: { $gte: addDays(today, -89) } }, UPTIME_FIELDS).lean(),
    getIncidentsSince(id, new Date(now - 7 * DAY_MS), now),
    getWatchStart(id),
  ]);
  // No start of watching means nothing was ever recorded: no data, not 100%.
  const window = (days) =>
    watchStart
      ? windowUptime({ incidents, from: new Date(now - days * DAY_MS), to: now, now, watchStart })
          .uptime
      : null;
  const lastDays = (days) =>
    combineRollups(rollups.filter((r) => r.date >= addDays(today, 1 - days)));

  return {
    h24: window(1),
    d7: window(7),
    d30: lastDays(30).uptime,
    d90: lastDays(90).uptime,
    includesSampleData: rollups.some((r) => r.isSeed) || incidents.some((i) => i.isSeed),
  };
}

/**
 * Uptime across every monitor of a workspace for the last `days` days (rollups,
 * today included): total downtime over total covered time, plus each monitor's
 * own figure. null when nothing was covered ("no data yet", not 100%).
 */
export async function getUptimeSummary(workspaceId, days, now = new Date()) {
  const monitors = await Monitor.find({ workspaceId: toObjectId(workspaceId) }, { _id: 1 }).lean();
  const rollups = await DailyRollup.find(
    {
      monitorId: { $in: monitors.map((m) => m._id) },
      date: { $gte: addDays(utcDayStart(now), 1 - days) },
    },
    UPTIME_FIELDS,
  ).lean();

  let downtimeSec = 0;
  let coveredSec = 0;
  const perMonitor = monitors.map((monitor) => {
    const own = combineRollups(rollups.filter((r) => String(r.monitorId) === String(monitor._id)));
    downtimeSec += own.downtimeSec;
    coveredSec += own.coveredSec;
    return { id: String(monitor._id), uptime: own.uptime };
  });
  return { days, uptime: uptimeFromDowntime(downtimeSec, coveredSec), monitors: perMonitor };
}

const toPoint = (check) => ({
  t: check.timestamp,
  totalMs: check.totalMs,
  ok: check.ok,
  // Older results have no state: derive it from ok. 'unknown' = the checker was offline.
  state: check.state ?? (check.ok ? CHECK_STATE.OK : CHECK_STATE.FAILED),
  errorCode: check.errorCode ?? null,
  error: check.error ?? null,
  sample: Boolean(check.isSeed),
  statusCode: check.statusCode ?? null,
  timings: check.timings ?? null,
});

/** The latest `limit` raw checks, oldest first (timing breakdown chart). */
export async function getRecentChecks(monitorId, limit) {
  const checks = await CheckResult.find({ 'meta.monitorId': toObjectId(monitorId) })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  return { points: checks.reverse().map(toPoint), downsampled: false, bucketSec: null };
}

/**
 * Checks in [from, to) for the response-time chart. Up to 500 points are
 * returned raw; beyond that they're averaged into equal time buckets in
 * MongoDB, so a 7-day range (~60k checks at 10s) is still a light response.
 * A bucket is "ok" only if every counted check in it passed, so outages never
 * get averaged away; unknown results (checker offline) are not counted, and a
 * bucket of nothing but unknown has state 'unknown'.
 */
export async function getChecksInRange(monitorId, from, to) {
  const match = { 'meta.monitorId': toObjectId(monitorId), timestamp: { $gte: from, $lt: to } };
  const count = await CheckResult.countDocuments(match);

  if (count <= MAX_CHART_POINTS) {
    const checks = await CheckResult.find(match).sort({ timestamp: 1 }).lean();
    return { points: checks.map(toPoint), downsampled: false, bucketSec: null };
  }

  const bucketSec = bucketSizeMs(to - from, MAX_CHART_POINTS) / 1000;
  const buckets = await CheckResult.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateTrunc: { date: '$timestamp', unit: 'second', binSize: bucketSec } },
        totalMs: { $avg: '$totalMs' },
        maxMs: { $max: '$totalMs' },
        count: { $sum: 1 },
        known: { $sum: { $cond: [{ $ne: ['$state', CHECK_STATE.UNKNOWN] }, 1, 0] } },
        upCount: { $sum: { $cond: ['$ok', 1, 0] } },
        errorCode: { $max: { $cond: ['$ok', null, '$errorCode'] } },
        sample: { $max: '$isSeed' },
        dnsMs: { $avg: '$timings.dnsMs' },
        tcpMs: { $avg: '$timings.tcpMs' },
        tlsMs: { $avg: '$timings.tlsMs' },
        ttfbMs: { $avg: '$timings.ttfbMs' },
        downloadMs: { $avg: '$timings.downloadMs' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  // Rounded here, not in $group: inside $group MongoDB treats $round as an
  // accumulator, which can't wrap $avg.
  const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);

  return {
    downsampled: true,
    bucketSec,
    points: buckets.map((b) => ({
      t: b._id,
      totalMs: round1(b.totalMs),
      maxMs: b.maxMs,
      ok: b.known > 0 && b.upCount === b.known,
      state:
        b.known === 0
          ? CHECK_STATE.UNKNOWN
          : b.upCount === b.known
            ? CHECK_STATE.OK
            : CHECK_STATE.FAILED,
      errorCode: b.errorCode ?? null,
      sample: Boolean(b.sample),
      upRatio: b.known ? b.upCount / b.known : null,
      count: b.count,
      timings: {
        dnsMs: round1(b.dnsMs),
        tcpMs: round1(b.tcpMs),
        tlsMs: round1(b.tlsMs),
        ttfbMs: round1(b.ttfbMs),
        downloadMs: round1(b.downloadMs),
      },
    })),
  };
}

/** Last `days` days of rollups, one entry per day (gaps filled), for the uptime bars. */
export async function getDailySeries(monitorId, days, now = new Date()) {
  const rollups = await DailyRollup.find({
    monitorId: toObjectId(monitorId),
    date: { $gte: addDays(utcDayStart(now), 1 - days) },
  }).lean();
  return fillDailySeries(rollups, { days, today: now });
}

/**
 * Recent response times of every monitor in a workspace, in ONE query, for
 * the dashboard sparklines (instead of one request per card).
 */
export async function getSparklines(workspaceId, points, now = new Date()) {
  const rows = await CheckResult.aggregate([
    {
      $match: {
        'meta.workspaceId': toObjectId(workspaceId),
        timestamp: { $gte: new Date(now - 6 * 60 * 60 * 1000) },
      },
    },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$meta.monitorId',
        recent: {
          $push: {
            t: '$timestamp',
            ms: '$totalMs',
            ok: '$ok',
            state: { $ifNull: ['$state', { $cond: ['$ok', CHECK_STATE.OK, CHECK_STATE.FAILED] }] },
          },
        },
      },
    },
    { $project: { recent: { $reverseArray: { $slice: ['$recent', points] } } } },
  ]);
  return Object.fromEntries(rows.map((row) => [String(row._id), row.recent]));
}

const AGENT_TOP_ROUTES = 10;

/**
 * Charts for an agent monitor (U4) between from and to: one point per report
 * window, or time buckets when there would be more than MAX_CHART_POINTS
 * (requests and errors summed; p50 averaged; p95/p99 the bucket's worst, so
 * spikes stay visible). Plus the busiest routes of the range and the latest
 * report's agent details.
 */
export async function getAgentMetrics(monitorId, from, to) {
  const id = toObjectId(monitorId);
  const match = { 'meta.monitorId': id, windowEnd: { $gte: from, $lt: to } };
  const count = await AgentReport.countDocuments(match);
  const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);
  const toPoint = (p) => ({
    t: p.t,
    requests: p.requests,
    errors5xx: p.errors5xx,
    errors4xx: p.errors4xx,
    errorRate: round1(errorRateOf(p)),
    p50Ms: round1(p.p50Ms),
    p95Ms: round1(p.p95Ms),
    p99Ms: round1(p.p99Ms),
  });

  let points;
  let bucketSec = null;
  if (count <= MAX_CHART_POINTS) {
    const reports = await AgentReport.find(match, { topRoutes: 0 }).sort({ windowEnd: 1 }).lean();
    points = reports.map((r) => toPoint({ ...r, t: r.windowEnd }));
  } else {
    bucketSec = bucketSizeMs(to - from, MAX_CHART_POINTS) / 1000;
    const buckets = await AgentReport.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateTrunc: { date: '$windowEnd', unit: 'second', binSize: bucketSec } },
          requests: { $sum: '$requests' },
          errors5xx: { $sum: '$errors5xx' },
          errors4xx: { $sum: '$errors4xx' },
          p50Ms: { $avg: '$p50Ms' },
          p95Ms: { $max: '$p95Ms' },
          p99Ms: { $max: '$p99Ms' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    points = buckets.map((b) => toPoint({ ...b, t: b._id }));
  }

  const [routes, last] = await Promise.all([
    AgentReport.aggregate([
      { $match: match },
      { $unwind: '$topRoutes' },
      {
        $group: {
          _id: '$topRoutes.route',
          requests: { $sum: '$topRoutes.requests' },
          errors5xx: { $sum: '$topRoutes.errors5xx' },
          p95Ms: { $max: '$topRoutes.p95Ms' },
        },
      },
      { $sort: { requests: -1, _id: 1 } },
      { $limit: AGENT_TOP_ROUTES },
    ]),
    AgentReport.findOne(
      { 'meta.monitorId': id },
      { hostname: 1, agentVersion: 1, uptimeSec: 1, windowEnd: 1 },
    )
      .sort({ windowEnd: -1 })
      .lean(),
  ]);

  return {
    points,
    downsampled: bucketSec != null,
    bucketSec,
    topRoutes: routes.map((r) => ({
      route: r._id,
      requests: r.requests,
      errors5xx: r.errors5xx,
      p95Ms: round1(r.p95Ms),
    })),
    lastReport: last
      ? {
          hostname: last.hostname ?? null,
          agentVersion: last.agentVersion ?? null,
          uptimeSec: last.uptimeSec ?? null,
          windowEnd: last.windowEnd,
        }
      : null,
  };
}
