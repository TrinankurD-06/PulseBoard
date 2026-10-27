// What `npm run seed` puts in a workspace: real-site monitors that start empty,
// and fictional "Demo ..." monitors with backfilled history. Lives here (not in
// seed.js) so tests can run it against an in-memory database.
//
// Real sites (Google, GitHub, Example.com) are real monitors: they get no
// history, no incidents and no usage, and wait for the worker's first check.
// The fictional monitors point at the local demo-target, so their history is
// invented; every document they own is flagged `isSeed` and `npm run seed:clear`
// removes them.
import {
  AGENT_SILENCE_STATE,
  CHECK_SOURCES,
  MONITOR_STATUS,
  MONITOR_TYPES,
} from '@pulseboard/shared/constants';
import { monthKey, monthStart } from '@pulseboard/shared/cost';
import {
  AgentReport,
  CheckResult,
  DailyRollup,
  Incident,
  Monitor,
  MonitorUsage,
} from '@pulseboard/shared/models';
import { rollupDay } from '@pulseboard/shared/rollup';
import { agentCreateSchema, buildMonitorSchemas } from '@pulseboard/shared/schemas';
import { addDays, DAY_MS, utcDayStart } from '@pulseboard/shared/uptime';
import { agentKeyFields } from '../../src/modules/agent/agentKey.js';
import { heartbeatDueAt } from '../../src/modules/monitors/monitors.service.js';

const HISTORY_DAYS = 30;
const RAW_STEP_MS = 5 * 60 * 1000; // backfilled raw checks: at most one every 5 minutes for 24h
const AGENT_REPORT_HISTORY_MS = 60 * 60 * 1000; // agent charts: the last hour
const MIN = 60 * 1000;

const AGENT_ROUTES = [
  ['/api/orders/:id', 0.4, 18],
  ['/api/cart', 0.25, 22],
  ['/api/products', 0.25, 30],
  ['/health', 0.1, 3],
];

const round1 = (value) => Math.round(value * 10) / 10;
const typeOf = (spec) => spec.type ?? MONITOR_TYPES.HTTP;

const SOURCE_OF = {
  [MONITOR_TYPES.HTTP]: CHECK_SOURCES.HTTP,
  [MONITOR_TYPES.HEARTBEAT]: CHECK_SOURCES.HEARTBEAT,
  [MONITOR_TYPES.AGENT]: CHECK_SOURCES.AGENT,
};

/**
 * The monitors, as they'd be sent to the API (defaults come from the same
 * schemas). `demo: true` marks the fictional ones: they get history and isSeed.
 * `latency` is the typical response time (http), run duration (heartbeat) or
 * median latency (agent); `phases` how an http response splits into
 * DNS/TCP/TLS/TTFB/download. `backedOffSec`: where the adaptive interval settles.
 */
export function buildMonitorSpecs({ demoMode, demoTargetUrl }) {
  return [
    {
      demo: true,
      name: 'Demo API',
      url: demoTargetUrl,
      // GET and fixed (non-adaptive) so the demo reacts fast.
      method: 'GET',
      adaptive: false,
      intervalSec: demoMode ? 10 : 30,
      timeoutMs: 5000,
      costPer1kRequests: 0.5,
      currency: 'INR',
      latency: 12,
      phases: [0.1, 0.1, 0, 0.75, 0.05],
    },
    {
      demo: true,
      name: 'Demo Checkout',
      url: demoTargetUrl,
      method: 'GET',
      adaptive: false,
      intervalSec: demoMode ? 10 : 30,
      timeoutMs: 5000,
      keyword: 'healthy',
      latency: 18,
      phases: [0.1, 0.1, 0, 0.75, 0.05],
    },
    {
      demo: true,
      type: MONITOR_TYPES.HEARTBEAT,
      name: 'Demo Cron Job',
      expectedEverySec: demoMode ? 60 : 3600,
      graceSec: 30,
      latency: 4200,
    },
    {
      demo: true,
      type: MONITOR_TYPES.AGENT,
      name: 'Demo Agent',
      reportEverySec: demoMode ? 30 : 60,
      probeUrl: demoTargetUrl,
      latency: 14,
    },
    // Real sites: no backfilled data of any kind.
    { name: 'Google', url: 'https://www.google.com/', method: 'HEAD', intervalSec: 60 },
    {
      name: 'GitHub',
      url: 'https://github.com/',
      method: 'HEAD',
      intervalSec: 60,
      costPer1kRequests: 0.4,
      currency: 'USD',
    },
    {
      name: 'Example.com',
      url: 'https://example.com/',
      method: 'HEAD',
      intervalSec: 60,
      costPer1kRequests: 0.25,
      currency: 'INR',
      monthlyRequestBudget: 15_000,
    },
  ];
}

/** Past outages of the fictional monitors: [monitor name, started (ms ago), minutes, cause]. */
const OUTAGES = [
  ['Demo API', 6 * 60 * MIN, 15, 'Unexpected status 500 (expected 200–399)'],
  ['Demo API', 27 * DAY_MS + 2 * 60 * MIN, 48, 'DNS lookup failed: host not found'],
  ['Demo Checkout', 9 * DAY_MS + 3 * 60 * MIN, 22, 'Unexpected status 503 (expected 200–399)'],
  ['Demo Checkout', 21 * DAY_MS + 11 * 60 * MIN, 4, 'Connection timed out'],
  [
    'Demo Cron Job',
    4 * DAY_MS + 2 * 60 * MIN,
    35,
    'pg_dump: could not write to file: No space left on device',
  ],
  ['Demo Agent', 13 * DAY_MS + 5 * 60 * MIN, 9, 'Error rate 12.4 % above 5 %'],
];

/**
 * Creates the seeded monitors in `workspace` and, for the fictional ones, their
 * history. `includeLocalDemo` false skips the fictional monitors (they need a
 * local demo-target). Returns { monitors, specs } (specs in the same order).
 */
export async function seedMonitors({
  workspace,
  scheduler,
  secrets,
  includeLocalDemo,
  demoMode,
  demoTargetUrl,
  now = Date.now(),
}) {
  const schemas = buildMonitorSchemas({ demoMode });
  const specs = buildMonitorSpecs({ demoMode, demoTargetUrl }).filter(
    (spec) => includeLocalDemo || !spec.demo,
  );

  // Deterministic pseudo-random numbers, so every seed run looks the same.
  let state = 42;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };

  /** Seconds between two results of this monitor (check, ping or report). */
  const periodSec = (spec) => {
    if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) return spec.expectedEverySec;
    if (typeOf(spec) === MONITOR_TYPES.AGENT) return spec.reportEverySec;
    return spec.intervalSec;
  };

  /** The monitor document for a spec, with the API's defaults applied. */
  const monitorDoc = (spec) => {
    const { demo, latency: _latency, phases: _phases, ...input } = spec;
    const base = { isSeed: Boolean(demo) };
    if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) {
      return {
        ...schemas.heartbeatCreate.parse(input),
        heartbeatToken: secrets.heartbeatToken,
        ...base,
      };
    }
    if (typeOf(spec) === MONITOR_TYPES.AGENT) {
      return {
        ...agentCreateSchema.parse(input),
        ...agentKeyFields(secrets.agentKey),
        silenceState: AGENT_SILENCE_STATE.REPORTING,
        ...base,
      };
    }
    const monitor = schemas.create.parse(input);
    return { ...monitor, currentIntervalSec: monitor.intervalSec, ...base };
  };

  const outagesOf = (spec) => OUTAGES.filter(([name]) => name === spec.name);

  const isDuringOutage = (spec, timestamp) =>
    outagesOf(spec).some(([, agoMs, minutes]) => {
      const start = now - agoMs;
      return timestamp >= start && timestamp < start + minutes * MIN;
    });

  /** What one backfilled result looks like for the push types (null for http). */
  const resultFields = (spec, down) => {
    const cause = down ? outagesOf(spec)[0][3] : null;
    const jitter = 0.85 + random() * 0.3;
    if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) {
      // totalMs is the job's run duration (from /start to the ping).
      return {
        statusCode: null,
        error: cause,
        totalMs: Math.round(spec.latency * jitter),
        timings: null,
      };
    }
    if (typeOf(spec) === MONITOR_TYPES.AGENT) {
      // totalMs is the window's median latency.
      return {
        statusCode: null,
        error: cause,
        totalMs: round1(spec.latency * jitter),
        timings: null,
      };
    }
    return null;
  };

  /** 24 hours of raw checks (one per period, at most one per 5 min), consistent with outages. */
  const rawChecks = (monitor, spec) => {
    const stepMs = Math.max(RAW_STEP_MS, periodSec(spec) * 1000);
    const checks = [];
    for (let t = now - DAY_MS + stepMs; t <= now; t += stepMs) {
      const down = isDuringOutage(spec, t);
      const base = {
        timestamp: new Date(t),
        meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
        ok: !down,
        source: SOURCE_OF[typeOf(spec)],
        isSeed: true,
      };
      const pushFields = resultFields(spec, down);
      if (pushFields) {
        checks.push({ ...base, ...pushFields });
        continue;
      }
      const wave = 1 + 0.25 * Math.sin((t / DAY_MS) * 2 * Math.PI); // busier in the daytime
      const totalMs = round1(spec.latency * wave * (0.85 + random() * 0.3));
      const [dns, tcp, tls, ttfb, download] = spec.phases.map((share) => round1(totalMs * share));
      checks.push({
        ...base,
        statusCode: down ? 500 : 200,
        error: down ? outagesOf(spec)[0][3] : null,
        totalMs: down ? round1(3 + random() * 3) : totalMs,
        timings: down
          ? null
          : { dnsMs: dns, tcpMs: tcp, tlsMs: tls, ttfbMs: ttfb, downloadMs: download },
      });
    }
    return checks;
  };

  /** Days 1..30 before today: mostly perfect, with downtime where an outage happened. */
  const historicalRollups = (monitor, spec) => {
    const period = periodSec(spec);
    const checksPerDay = Math.round(DAY_MS / (period * 1000));
    // A single failed result opens a heartbeat incident, so heartbeats get no random blips.
    const blips = typeOf(spec) !== MONITOR_TYPES.HEARTBEAT;
    const today = utcDayStart(now);
    const rollups = [];
    for (let d = 1; d <= HISTORY_DAYS; d += 1) {
      const date = addDays(today, -d);
      const dayEnd = addDays(date, 1).getTime();
      const downtimeSec = outagesOf(spec)
        .map(([, agoMs, minutes]) => [now - agoMs, now - agoMs + minutes * MIN])
        .filter(([start]) => start >= date.getTime() && start < dayEnd)
        .reduce((sum, [start, end]) => sum + (end - start) / 1000, 0);
      const blip = blips && random() < 0.15 ? 1 : 0;
      const failed = Math.min(
        checksPerDay,
        Math.max(downtimeSec > 0 ? 1 : 0, Math.round(downtimeSec / period)) + blip,
      );
      rollups.push({
        monitorId: monitor._id,
        workspaceId: monitor.workspaceId,
        date,
        totalChecks: checksPerDay,
        upChecks: checksPerDay - failed,
        avgResponseMs: round1(spec.latency * (0.95 + random() * 0.1)),
        p95ResponseMs: round1(spec.latency * (1.4 + random() * 0.3)),
        downtimeSec,
        // A full backfilled day is covered for all of its 86400 seconds.
        coveredSec: 86400,
        isFinal: true,
        isSeed: true,
      });
    }
    return rollups;
  };

  /** Same wording as the incident engine uses for each type. */
  const openedMessage = (spec, cause) => {
    if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) return `Heartbeat missing or failed: ${cause}`;
    if (typeOf(spec) === MONITOR_TYPES.AGENT) {
      return `Down after 3 consecutive failed reports or probes: ${cause}`;
    }
    return `Down after 3 consecutive failed checks: ${cause}`;
  };

  const recoveredMessage = (spec) => {
    if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) return 'Recovered: pings are arriving again';
    if (typeOf(spec) === MONITOR_TYPES.AGENT) return 'Recovered: agent reports are healthy again';
    return 'Recovered: checks are passing again';
  };

  const incidentsFor = (monitor, spec) =>
    outagesOf(spec).map(([, agoMs, minutes, cause]) => {
      const startedAt = new Date(now - agoMs);
      const resolvedAt = new Date(startedAt.getTime() + minutes * MIN);
      return {
        monitorId: monitor._id,
        workspaceId: monitor.workspaceId,
        startedAt,
        resolvedAt,
        durationSec: minutes * 60,
        cause,
        timeline: [
          {
            at: new Date(startedAt.getTime() + 2 * MIN),
            type: 'opened',
            message: openedMessage(spec, cause),
          },
          {
            at: new Date(startedAt.getTime() + 2 * MIN + 2000),
            type: 'alert_sent',
            message: 'Down alerts sent to all enabled channels',
          },
          { at: resolvedAt, type: 'resolved', message: recoveredMessage(spec) },
          {
            at: new Date(resolvedAt.getTime() + 2000),
            type: 'alert_sent',
            message: 'Recovery alerts sent to all enabled channels',
          },
        ],
        deliveredAlerts: [],
        isSeed: true,
      };
    });

  /** The last hour of agent reports, so the agent page has charts straight away. */
  const agentReports = (monitor, spec) => {
    const windowMs = spec.reportEverySec * 1000;
    const reports = [];
    for (let end = now - AGENT_REPORT_HISTORY_MS + windowMs; end <= now; end += windowMs) {
      const requests = Math.round(spec.reportEverySec * (1.6 + random() * 0.8)); // ~2 req/s
      const errors5xx = random() < 0.1 ? 1 : 0;
      const p50Ms = round1(spec.latency * (0.9 + random() * 0.2));
      reports.push({
        windowStart: new Date(end - windowMs),
        windowEnd: new Date(end),
        meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
        requests,
        errors5xx,
        errors4xx: Math.round(requests * 0.02 * random()),
        p50Ms,
        p95Ms: round1(p50Ms * (2.4 + random() * 0.4)),
        p99Ms: round1(p50Ms * (4.5 + random() * 1)),
        topRoutes: AGENT_ROUTES.map(([route, share, latency]) => ({
          route,
          requests: Math.round(requests * share),
          errors5xx: route === '/api/orders/:id' ? errors5xx : 0,
          p95Ms: round1(latency * (2 + random() * 0.5)),
        })),
        agentVersion: '1.0.0',
        hostname: 'demo-target',
        uptimeSec: Math.round((end - (now - DAY_MS)) / 1000),
        isSeed: true,
      });
    }
    return reports;
  };

  /** This month's usage so far, as if the monitor had run since the 1st. */
  const usageThisMonth = (monitor, spec) => {
    const elapsedSec = Math.floor((now - monthStart(new Date(now)).getTime()) / 1000);
    const count = Math.floor(elapsedSec / periodSec(spec));
    const type = typeOf(spec);
    return {
      monitorId: monitor._id,
      workspaceId: monitor.workspaceId,
      month: monthKey(new Date(now)),
      requests: type === MONITOR_TYPES.HTTP ? count : 0,
      pings: type === MONITOR_TYPES.HEARTBEAT ? count : 0,
      reports: type === MONITOR_TYPES.AGENT ? count : 0,
      isSeed: true,
    };
  };

  /** The "last result" fields, plus what each push type needs to start out healthy. */
  const liveFields = (spec, last) => {
    const fields = {
      status: MONITOR_STATUS.UP,
      consecutiveSuccesses: 1,
      lastCheckedAt: last.timestamp,
      lastResponseMs: last.totalMs,
      lastOk: last.ok,
      lastStatusCode: last.statusCode,
      lastTimings: last.timings,
    };
    if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) {
      // The next ping is due one period (+ grace) from now: start the heartbeat
      // script before then, or the demo shows "pings stopped" (that's the point).
      return { ...fields, lastPingAt: last.timestamp, nextDueAt: heartbeatDueAt(spec, new Date()) };
    }
    if (typeOf(spec) === MONITOR_TYPES.AGENT) {
      return { ...fields, lastReportAt: last.timestamp, watchSince: new Date() };
    }
    return fields;
  };

  const monitors = await Monitor.insertMany(
    specs.map((spec) => ({
      ...monitorDoc(spec),
      workspaceId: workspace._id,
      status: MONITOR_STATUS.PENDING,
    })),
  );

  for (const [position, monitor] of monitors.entries()) {
    const spec = specs[position];
    if (spec.demo) {
      const checks = rawChecks(monitor, spec);
      await CheckResult.insertMany(checks);
      await DailyRollup.insertMany(historicalRollups(monitor, spec));
      await Incident.insertMany(incidentsFor(monitor, spec));
      await MonitorUsage.create(usageThisMonth(monitor, spec));
      if (typeOf(spec) === MONITOR_TYPES.AGENT) {
        await AgentReport.insertMany(agentReports(monitor, spec));
      }
      // Start "up" with the latest backfilled result, so the dashboard looks alive at once.
      await Monitor.updateOne({ _id: monitor._id }, liveFields(spec, checks.at(-1)));
    }
    // Real sites stay pending until the worker's first check. No-op for heartbeats;
    // agent monitors only get a job with an external check.
    await scheduler.scheduleMonitor(monitor);
  }

  // Today's (and yesterday's) rollups of the fictional monitors, from their raw
  // checks, with the real rollup code. Flagged afterwards: the code does not know about isSeed.
  const demoIds = monitors.filter((_, position) => specs[position].demo).map((m) => m._id);
  if (demoIds.length) {
    await rollupDay(new Date(now), { now: new Date(now) });
    await rollupDay(new Date(now - DAY_MS), { isFinal: true, now: new Date(now) });
    await DailyRollup.updateMany({ monitorId: { $in: demoIds } }, { $set: { isSeed: true } });
  }

  return { monitors, specs };
}
