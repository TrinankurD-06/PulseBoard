// Adds ONE fictional monitor with a believable incident history to an existing
// workspace, for demos and screen recordings. Unlike `npm run seed` it removes
// nothing else: the workspace, its real monitors and its data stay as they are.
//
// Everything created is flagged `isSeed` (shown as "Sample data" in the app) and
// `npm run seed:clear` removes it. The monitor is not scheduled, so no worker
// checks it and no real alert is sent for it; it points at https://example.com
// (which answers 200), so if a worker does pick it up later (reconcile on boot)
// it simply stays up.
import { CHECK_SOURCES, MONITOR_STATUS } from '../constants.js';
import { monthKey, monthStart } from '../cost/index.js';
import { CheckResult, DailyRollup, Incident, Monitor, MonitorUsage } from '../models/index.js';
import { rollupDay } from '../rollup/index.js';
import { buildMonitorSchemas } from '../schemas/index.js';
import { addDays, DAY_MS, utcDayStart } from '../uptime/index.js';

export const DEMO_MONITOR_NAME = 'Demo Checkout API';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const INTERVAL_SEC = 60;
const HISTORY_DAYS = 30;
const RAW_STEP_MS = 5 * MIN; // backfilled raw checks: one every 5 minutes for 24 h
const LATENCY_MS = 140;

/**
 * The incidents, newest last. `agoMs` is when each started; `minutes` how long it
 * lasted; `alertFailedFirst` adds a failed first delivery that succeeded on retry.
 */
export const DEMO_INCIDENTS = [
  {
    agoMs: 27 * DAY_MS + 2 * HOUR,
    minutes: 38,
    cause: 'HTTP 503 Service Unavailable',
    code: 'HTTP_503',
    statusCode: 503,
  },
  {
    agoMs: 19 * DAY_MS + 5 * HOUR,
    minutes: 12,
    cause: 'Request timed out after 5000 ms',
    code: 'ETIMEDOUT',
    statusCode: null,
  },
  {
    agoMs: 11 * DAY_MS + 9 * HOUR,
    minutes: 47,
    cause: 'Keyword "Add to cart" not found in the response',
    code: 'KEYWORD_MISSING',
    statusCode: 200,
    alertFailedFirst: true,
  },
  {
    agoMs: 5 * DAY_MS + 3 * HOUR,
    minutes: 6,
    cause: 'Connection refused',
    code: 'ECONNREFUSED',
    statusCode: null,
  },
  {
    agoMs: 7 * HOUR,
    minutes: 14,
    cause: 'HTTP 500 Internal Server Error',
    code: 'HTTP_500',
    statusCode: 500,
  },
];

const round1 = (value) => Math.round(value * 10) / 10;

function timelineOf(incident, startedAt, resolvedAt) {
  const opened = new Date(startedAt.getTime() + 2 * MIN); // 3 failed checks, a minute apart
  const timeline = [
    {
      at: opened,
      type: 'opened',
      message: `Down after 3 consecutive failed checks: ${incident.cause}`,
      code: incident.code,
    },
  ];
  if (incident.alertFailedFirst) {
    timeline.push(
      {
        at: new Date(opened.getTime() + 2000),
        type: 'alert_failed',
        message: 'Down alert to "Ops email" failed (Resend timeout); retrying in 30 s',
      },
      {
        at: new Date(opened.getTime() + 32_000),
        type: 'alert_sent',
        message: 'Down alerts sent to all enabled channels (after 1 retry)',
      },
    );
  } else {
    timeline.push({
      at: new Date(opened.getTime() + 2000),
      type: 'alert_sent',
      message: 'Down alerts sent to all enabled channels',
    });
  }
  timeline.push(
    { at: resolvedAt, type: 'resolved', message: 'Recovered: checks are passing again' },
    {
      at: new Date(resolvedAt.getTime() + 2000),
      type: 'alert_sent',
      message: 'Recovery alerts sent to all enabled channels',
    },
  );
  return timeline;
}

/** Removes an earlier demo monitor of this name (and what it owns) from the workspace. */
export async function removeDemoMonitor(workspaceId) {
  const old = await Monitor.find(
    { workspaceId, name: DEMO_MONITOR_NAME, isSeed: true },
    { _id: 1 },
  ).lean();
  const ids = old.map((m) => m._id);
  if (!ids.length) return 0;
  await Promise.all([
    CheckResult.deleteMany({ 'meta.monitorId': { $in: ids } }),
    DailyRollup.deleteMany({ monitorId: { $in: ids } }),
    Incident.deleteMany({ monitorId: { $in: ids } }),
    MonitorUsage.deleteMany({ monitorId: { $in: ids } }),
    Monitor.deleteMany({ _id: { $in: ids } }),
  ]);
  return ids.length;
}

/**
 * Creates the monitor, its incidents, 24 h of raw checks (failing during the
 * recent incident), 30 days of rollups and this month's usage. Safe to run
 * twice: the previous demo monitor is replaced. Returns { monitor, incidents, replaced }.
 */
export async function addDemoIncidentMonitor({ workspaceId, now = Date.now() }) {
  const replaced = await removeDemoMonitor(workspaceId);
  const schemas = buildMonitorSchemas({ demoMode: false });
  const input = schemas.create.parse({
    name: DEMO_MONITOR_NAME,
    url: 'https://example.com/',
    method: 'GET',
    adaptive: false,
    intervalSec: INTERVAL_SEC,
    timeoutMs: 5000,
    keyword: 'Example Domain',
    costPer1kRequests: 0.5,
    currency: 'INR',
  });
  const monitor = await Monitor.create({
    ...input,
    currentIntervalSec: input.intervalSec,
    workspaceId,
    status: MONITOR_STATUS.PENDING,
    isSeed: true,
  });

  const incidents = DEMO_INCIDENTS.map((incident) => {
    const startedAt = new Date(now - incident.agoMs);
    const resolvedAt = new Date(startedAt.getTime() + incident.minutes * MIN);
    return {
      monitorId: monitor._id,
      workspaceId,
      startedAt,
      resolvedAt,
      durationSec: incident.minutes * 60,
      cause: incident.cause,
      causeCode: incident.code,
      timeline: timelineOf(incident, startedAt, resolvedAt),
      deliveredAlerts: [],
      isSeed: true,
    };
  });
  await Incident.insertMany(incidents);

  // 24 h of raw checks, one every 5 minutes; failing while an incident was running.
  const failing = DEMO_INCIDENTS.map((i) => [now - i.agoMs, now - i.agoMs + i.minutes * MIN, i]);
  const checks = [];
  for (let t = now - DAY_MS + RAW_STEP_MS; t <= now; t += RAW_STEP_MS) {
    const hit = failing.find(([start, end]) => t >= start && t < end)?.[2];
    const totalMs = round1(LATENCY_MS * (0.8 + 0.4 * Math.abs(Math.sin(t / HOUR))));
    checks.push({
      timestamp: new Date(t),
      meta: { monitorId: monitor._id, workspaceId },
      ok: !hit,
      state: hit ? 'failed' : 'ok',
      source: CHECK_SOURCES.HTTP,
      statusCode: hit ? (hit.statusCode ?? null) : 200,
      error: hit ? hit.cause : null,
      errorCode: hit ? hit.code : null,
      totalMs: hit ? round1(3 + (t % 7)) : totalMs,
      timings: hit
        ? null
        : {
            dnsMs: round1(totalMs * 0.1),
            tcpMs: round1(totalMs * 0.1),
            tlsMs: round1(totalMs * 0.2),
            ttfbMs: round1(totalMs * 0.55),
            downloadMs: round1(totalMs * 0.05),
          },
      isSeed: true,
    });
  }
  await CheckResult.insertMany(checks);

  // 30 days of rollups for the 90-day bars and the 30-day figure: downtime comes from the incidents.
  const today = utcDayStart(now);
  const checksPerDay = Math.round(DAY_MS / (INTERVAL_SEC * 1000));
  const rollups = [];
  for (let d = 1; d <= HISTORY_DAYS; d += 1) {
    const date = addDays(today, -d);
    const dayEnd = addDays(date, 1).getTime();
    const downtimeSec = failing
      .filter(([start]) => start >= date.getTime() && start < dayEnd)
      .reduce((sum, [start, end]) => sum + (end - start) / 1000, 0);
    rollups.push({
      monitorId: monitor._id,
      workspaceId,
      date,
      totalChecks: checksPerDay,
      upChecks: checksPerDay - Math.round(downtimeSec / INTERVAL_SEC),
      avgResponseMs: round1(LATENCY_MS * (0.95 + 0.1 * Math.abs(Math.sin(d)))),
      p95ResponseMs: round1(LATENCY_MS * (1.5 + 0.2 * Math.abs(Math.cos(d)))),
      downtimeSec,
      coveredSec: 86_400,
      isFinal: true,
      isSeed: true,
    });
  }
  await DailyRollup.insertMany(rollups);
  // Today and yesterday from the raw checks with the real rollup code, then flagged.
  await rollupDay(new Date(now), { now: new Date(now) });
  await rollupDay(new Date(now - DAY_MS), { isFinal: true, now: new Date(now) });
  await DailyRollup.updateMany({ monitorId: monitor._id }, { $set: { isSeed: true } });

  // This month's usage so far, as if it had run since the 1st.
  await MonitorUsage.create({
    monitorId: monitor._id,
    workspaceId,
    month: monthKey(new Date(now)),
    requests: Math.floor((now - monthStart(new Date(now)).getTime()) / 1000 / INTERVAL_SEC),
    isSeed: true,
  });

  const last = checks.at(-1);
  await Monitor.updateOne(
    { _id: monitor._id },
    {
      status: MONITOR_STATUS.UP,
      consecutiveSuccesses: 1,
      lastCheckedAt: last.timestamp,
      lastResponseMs: last.totalMs,
      lastOk: true,
      lastStatusCode: last.statusCode,
      lastTimings: last.timings,
    },
  );
  return {
    monitor: await Monitor.findById(monitor._id).lean(),
    incidents: incidents.length,
    replaced,
  };
}
