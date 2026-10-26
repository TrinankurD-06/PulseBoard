import { DEFAULT_CURRENCY } from '@pulseboard/shared/constants';
import {
  costOf,
  estimateMonthlyCost,
  estimateMonthlyRequests,
  estimateRequestsBetween,
  monthKey,
  monthStart,
} from '@pulseboard/shared/cost';
import { mongoose } from '@pulseboard/shared/db';
import { CheckResult, DailyRollup, Monitor } from '@pulseboard/shared/models';
import { requestsThisMonth } from '@pulseboard/shared/usage';
import {
  addDays,
  bucketSizeMs,
  combineRollups,
  DAY_MS,
  fillDailySeries,
  uptimePercent,
  utcDayStart,
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
  };
}

/**
 * Uptime % for the four windows shown on the monitor page.
 * 24h comes from raw checks (exact, minute-level); 7/30/90 days come from
 * daily rollups, because raw checks are only kept for 7 days. Today's rollup
 * is refreshed every 15 minutes, so the long windows include today.
 */
export async function getUptime(monitorId, now = new Date()) {
  const id = toObjectId(monitorId);
  const [raw] = await CheckResult.aggregate([
    { $match: { 'meta.monitorId': id, timestamp: { $gte: new Date(now - DAY_MS) } } },
    { $group: { _id: null, total: { $sum: 1 }, up: { $sum: { $cond: ['$ok', 1, 0] } } } },
  ]);

  const today = utcDayStart(now);
  const rollups = await DailyRollup.find(
    { monitorId: id, date: { $gte: addDays(today, -89) } },
    { date: 1, totalChecks: 1, upChecks: 1, downtimeSec: 1 },
  ).lean();
  const lastDays = (days) =>
    combineRollups(rollups.filter((r) => r.date >= addDays(today, 1 - days)));

  return {
    h24: uptimePercent(raw?.up ?? 0, raw?.total ?? 0),
    d7: lastDays(7).uptime,
    d30: lastDays(30).uptime,
    d90: lastDays(90).uptime,
  };
}

const toPoint = (check) => ({
  t: check.timestamp,
  totalMs: check.totalMs,
  ok: check.ok,
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
 * A bucket is "ok" only if every check in it passed, so outages never get
 * averaged away.
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
        upCount: { $sum: { $cond: ['$ok', 1, 0] } },
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
      ok: b.upCount === b.count,
      upRatio: b.upCount / b.count,
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
        recent: { $push: { t: '$timestamp', ms: '$totalMs', ok: '$ok' } },
      },
    },
    { $project: { recent: { $reverseArray: { $slice: ['$recent', points] } } } },
  ]);
  return Object.fromEntries(rows.map((row) => [String(row._id), row.recent]));
}
