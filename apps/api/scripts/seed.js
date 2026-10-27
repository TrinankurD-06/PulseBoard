// npm run seed: creates a ready-to-demo account with realistic history.
//
//   login: demo@pulseboard.dev / demo1234
//   workspace "Acme Inc." with 6 monitors: the local demo-target and 3 public
//     sites (http), a "Nightly backup" heartbeat and a "Checkout API (agent)"
//   an alert channel (from SEED_* variables in .env, else an Ethereal test inbox)
//   a public status page at /status/acme
//   30 days of daily rollups, 24 hours of raw checks, a few past incidents,
//     this month's usage, and the last hour of agent reports
//   apps/demo-target/.pulseboard-demo.json (git-ignored): the agent key and the
//     heartbeat URL, read by the demo-target and its heartbeat script
//
// Safe to run again: the previous demo account and its data are removed first.
// The agent key and heartbeat token in .pulseboard-demo.json are kept, so a
// demo-target or heartbeat script that is already running keeps working.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AGENT_KEY_PREFIX,
  AGENT_SILENCE_STATE,
  CHECK_SOURCES,
  MONITOR_STATUS,
  MONITOR_TYPES,
  ROLES,
} from '@pulseboard/shared/constants';
import { monthKey, monthStart } from '@pulseboard/shared/cost';
import { connectMongo, disconnectMongo, ensureCollections, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import {
  AgentReport,
  AlertChannel,
  CheckResult,
  DailyRollup,
  Incident,
  Membership,
  Monitor,
  MonitorUsage,
  Session,
  StatusPage,
  User,
} from '@pulseboard/shared/models';
import { rollupDay } from '@pulseboard/shared/rollup';
import {
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { agentCreateSchema, buildMonitorSchemas } from '@pulseboard/shared/schemas';
import { addDays, DAY_MS, utcDayStart } from '@pulseboard/shared/uptime';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { agentKeyFields, generateAgentKey, hashAgentKey } from '../src/modules/agent/agentKey.js';
import {
  generateHeartbeatToken,
  heartbeatDueAt,
} from '../src/modules/monitors/monitors.service.js';
import {
  createWorkspaceWithOwner,
  deleteWorkspace,
} from '../src/modules/workspaces/workspaces.service.js';

loadEnv();
const env = parseEnv(
  z.object({
    MONGODB_URI: z.string().min(1),
    DEMO_MODE: z.enum(['true', 'false']).default('false'),
    API_PORT: z.coerce.number().default(4000),
    DEMO_TARGET_PORT: z.coerce.number().default(4011),
    // Empty variables in .env mean "not set".
    SEED_DEMO_TARGET_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
    SEED_API_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
    // Force the local-only demo monitors on or off (default: on for a local database).
    SEED_LOCAL_DEMO: z.preprocess(
      (value) => value || undefined,
      z.enum(['true', 'false']).optional(),
    ),
    SEED_DISCORD_WEBHOOK_URL: z.string().optional(),
    SEED_SLACK_WEBHOOK_URL: z.string().optional(),
    SEED_ALERT_EMAIL: z.string().optional(),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  }),
);

const DEMO_EMAIL = 'demo@pulseboard.dev';
const DEMO_PASSWORD = 'demo1234';
const STATUS_SLUG = 'acme';
const HISTORY_DAYS = 30;
const RAW_STEP_MS = 5 * 60 * 1000; // backfilled raw checks: at most one every 5 minutes for 24h
const AGENT_REPORT_HISTORY_MS = 60 * 60 * 1000; // agent charts: the last hour
const now = Date.now();
const MIN = 60 * 1000;

const demoMode = env.DEMO_MODE === 'true';
const schemas = buildMonitorSchemas({ demoMode });
const DEMO_TARGET_URL = env.SEED_DEMO_TARGET_URL ?? `http://localhost:${env.DEMO_TARGET_PORT}/`;
const API_URL = (env.SEED_API_URL ?? `http://localhost:${env.API_PORT}/api/v1`).replace(/\/$/, '');
// The demo target, the heartbeat and the agent only work beside a local demo-target
// and its heartbeat script, so on a hosted database they would sit there down and
// open incidents. They are seeded for a local database, when a public demo target
// is given, or when SEED_LOCAL_DEMO=true.
const LOCAL_DB = /\/\/(?:[^/@]*@)?(?:localhost|127\.0\.0\.1)[:/]/.test(env.MONGODB_URI);
const includeLocalDemo = env.SEED_LOCAL_DEMO
  ? env.SEED_LOCAL_DEMO === 'true'
  : LOCAL_DB || Boolean(env.SEED_DEMO_TARGET_URL);
const DEMO_FILE = fileURLToPath(
  new URL('../../demo-target/.pulseboard-demo.json', import.meta.url),
);
const AGENT_KEY_FORMAT = new RegExp(`^${AGENT_KEY_PREFIX}[A-Za-z0-9_-]{32}$`);
const HEARTBEAT_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * The demo monitors, as they'd be sent to the API (defaults come from the same
 * schemas). `latency` is the typical response time (http), run duration
 * (heartbeat) or median latency (agent); `phases` how an http response splits
 * into DNS/TCP/TLS/TTFB/download, so the timing breakdown chart looks real.
 * `backedOffSec`: where the adaptive interval has settled after a long healthy run.
 */
const MONITORS = [
  {
    name: 'Checkout API (demo target)',
    url: DEMO_TARGET_URL,
    // GET because of the keyword, and fixed (non-adaptive) so the demo reacts fast.
    method: 'GET',
    adaptive: false,
    intervalSec: demoMode ? 10 : 30,
    timeoutMs: 5000,
    keyword: 'healthy',
    costPer1kRequests: 0.5,
    currency: 'INR',
    latency: 12,
    phases: [0.1, 0.1, 0, 0.75, 0.05],
  },
  {
    name: 'Google',
    url: 'https://www.google.com/',
    method: 'HEAD',
    intervalSec: 60,
    backedOffSec: 240,
    latency: 110,
    phases: [0.15, 0.12, 0.2, 0.45, 0.08],
  },
  {
    name: 'GitHub',
    url: 'https://github.com/',
    method: 'HEAD',
    intervalSec: 60,
    backedOffSec: 240,
    costPer1kRequests: 0.4,
    currency: 'USD',
    latency: 240,
    phases: [0.08, 0.1, 0.15, 0.5, 0.17],
  },
  {
    name: 'Example.com',
    url: 'https://example.com/',
    method: 'HEAD',
    intervalSec: 60,
    backedOffSec: 240,
    costPer1kRequests: 0.25,
    currency: 'INR',
    monthlyRequestBudget: 15_000,
    latency: 150,
    phases: [0.12, 0.18, 0.25, 0.4, 0.05],
  },
  {
    type: MONITOR_TYPES.HEARTBEAT,
    name: 'Nightly backup',
    expectedEverySec: demoMode ? 60 : 3600,
    graceSec: 30,
    latency: 4200,
  },
  {
    type: MONITOR_TYPES.AGENT,
    name: 'Checkout API (agent)',
    reportEverySec: demoMode ? 30 : 60,
    probeUrl: DEMO_TARGET_URL,
    latency: 14,
  },
];

/**
 * Past outages: [monitor index, started (ms ago), duration (minutes), cause].
 * Raw checks and rollups are generated to agree with them.
 */
const OUTAGES = [
  [0, 6 * 60 * MIN, 15, 'Unexpected status 500 (expected 200–399)'],
  [2, 9 * DAY_MS + 3 * 60 * MIN, 22, 'Unexpected status 503 (expected 200–399)'],
  [3, 21 * DAY_MS + 11 * 60 * MIN, 4, 'Connection timed out'],
  [1, 27 * DAY_MS + 2 * 60 * MIN, 48, 'DNS lookup failed: host not found'],
  [4, 4 * DAY_MS + 2 * 60 * MIN, 35, 'pg_dump: could not write to file: No space left on device'],
  [5, 13 * DAY_MS + 5 * 60 * MIN, 9, 'Error rate 12.4 % above 5 %'],
];

const AGENT_ROUTES = [
  ['/api/orders/:id', 0.4, 18],
  ['/api/cart', 0.25, 22],
  ['/api/products', 0.25, 30],
  ['/health', 0.1, 3],
];

// Deterministic pseudo-random numbers, so every seed run looks the same.
let state = 42;
const random = () => {
  state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return state / 4_294_967_296;
};
const round1 = (value) => Math.round(value * 10) / 10;

const typeOf = (spec) => spec.type ?? MONITOR_TYPES.HTTP;

const needsLocalDemo = (spec) =>
  typeOf(spec) !== MONITOR_TYPES.HTTP || spec.url === DEMO_TARGET_URL;
// Positions in MONITORS that get created. The positions are kept (not re-numbered)
// because OUTAGES and the generators below refer to monitors by that position.
const SEEDED = MONITORS.map((_, index) => index).filter(
  (index) => includeLocalDemo || !needsLocalDemo(MONITORS[index]),
);

/** Seconds between two results of this monitor (check, ping or report). */
function periodSec(spec) {
  if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) return spec.expectedEverySec;
  if (typeOf(spec) === MONITOR_TYPES.AGENT) return spec.reportEverySec;
  return spec.backedOffSec ?? spec.intervalSec;
}

const SOURCE_OF = {
  [MONITOR_TYPES.HTTP]: CHECK_SOURCES.HTTP,
  [MONITOR_TYPES.HEARTBEAT]: CHECK_SOURCES.HEARTBEAT,
  [MONITOR_TYPES.AGENT]: CHECK_SOURCES.AGENT,
};

async function removePreviousDemo(scheduler) {
  const user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) return;
  const owned = await Membership.find({ userId: user._id, role: ROLES.OWNER }).lean();
  for (const { workspaceId } of owned) await deleteWorkspace(workspaceId, scheduler);
  await Promise.all([
    Membership.deleteMany({ userId: user._id }),
    Session.deleteMany({ userId: user._id }),
    user.deleteOne(),
  ]);
  console.warn('Removed the previous demo account and its data.');
}

/** The previous run's demo file, or {} when missing or unreadable. */
function readDemoFile() {
  try {
    return JSON.parse(readFileSync(DEMO_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Keeps the previous agent key and heartbeat token when they are well-formed
 * and no other monitor uses them (the demo monitors themselves were just
 * removed); otherwise new ones are generated.
 */
async function demoSecrets() {
  const previous = readDemoFile();
  const oldKey = typeof previous.agentKey === 'string' ? previous.agentKey : '';
  const keyFree =
    AGENT_KEY_FORMAT.test(oldKey) &&
    !(await Monitor.exists({ agentKeyHash: hashAgentKey(oldKey) }));
  const oldToken =
    typeof previous.heartbeatUrl === 'string'
      ? (previous.heartbeatUrl.split('/ping/')[1] ?? '')
      : '';
  const tokenFree =
    HEARTBEAT_TOKEN_FORMAT.test(oldToken) && !(await Monitor.exists({ heartbeatToken: oldToken }));
  return {
    agentKey: keyFree ? oldKey : generateAgentKey(),
    heartbeatToken: tokenFree ? oldToken : generateHeartbeatToken(),
    reused: { agentKey: keyFree, heartbeatToken: tokenFree },
  };
}

/** The monitor document for a spec, with the API's defaults applied. */
function monitorDoc(spec, secrets) {
  const { latency: _latency, phases: _phases, backedOffSec, ...input } = spec;
  if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) {
    return { ...schemas.heartbeatCreate.parse(input), heartbeatToken: secrets.heartbeatToken };
  }
  if (typeOf(spec) === MONITOR_TYPES.AGENT) {
    return {
      ...agentCreateSchema.parse(input),
      ...agentKeyFields(secrets.agentKey),
      silenceState: AGENT_SILENCE_STATE.REPORTING,
    };
  }
  const monitor = schemas.create.parse(input);
  return { ...monitor, currentIntervalSec: backedOffSec ?? monitor.intervalSec };
}

function alertChannelsFromEnv() {
  const channels = [];
  if (env.SEED_DISCORD_WEBHOOK_URL) {
    channels.push({
      name: '#ops (Discord)',
      type: 'discord',
      target: env.SEED_DISCORD_WEBHOOK_URL,
    });
  }
  if (env.SEED_SLACK_WEBHOOK_URL) {
    channels.push({ name: '#ops (Slack)', type: 'slack', target: env.SEED_SLACK_WEBHOOK_URL });
  }
  if (env.SEED_ALERT_EMAIL || channels.length === 0) {
    // Without SMTP settings this goes to an Ethereal test inbox (preview link in the timeline).
    channels.push({
      name: 'On-call inbox',
      type: 'email',
      target: env.SEED_ALERT_EMAIL || DEMO_EMAIL,
    });
  }
  return channels;
}

const outagesOf = (index) => OUTAGES.filter(([monitorIndex]) => monitorIndex === index);

function isDuringOutage(index, timestamp) {
  return outagesOf(index).some(([, agoMs, minutes]) => {
    const start = now - agoMs;
    return timestamp >= start && timestamp < start + minutes * MIN;
  });
}

/** What one backfilled result looks like for each monitor type. */
function resultFields(spec, index, down) {
  const cause = down ? outagesOf(index)[0][3] : null;
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
}

/** 24 hours of raw checks (one per period, at most one per 5 min), consistent with outages. */
function rawChecks(monitor, index) {
  const spec = MONITORS[index];
  const stepMs = Math.max(RAW_STEP_MS, periodSec(spec) * 1000);
  const checks = [];
  for (let t = now - DAY_MS + stepMs; t <= now; t += stepMs) {
    const down = isDuringOutage(index, t);
    const base = {
      timestamp: new Date(t),
      meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
      ok: !down,
      source: SOURCE_OF[typeOf(spec)],
    };
    const pushFields = resultFields(spec, index, down);
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
      error: down ? outagesOf(index)[0][3] : null,
      totalMs: down ? round1(3 + random() * 3) : totalMs,
      timings: down
        ? null
        : { dnsMs: dns, tcpMs: tcp, tlsMs: tls, ttfbMs: ttfb, downloadMs: download },
    });
  }
  return checks;
}

/** Days 1..30 before today: mostly perfect, with downtime where an outage happened. */
function historicalRollups(monitor, index) {
  const spec = MONITORS[index];
  const period = periodSec(spec);
  const checksPerDay = Math.round(DAY_MS / (period * 1000));
  // A single failed result opens a heartbeat incident, so heartbeats get no random blips.
  const blips = typeOf(spec) !== MONITOR_TYPES.HEARTBEAT;
  const today = utcDayStart(now);
  const rollups = [];
  for (let d = 1; d <= HISTORY_DAYS; d += 1) {
    const date = addDays(today, -d);
    const dayEnd = addDays(date, 1).getTime();
    const downtimeSec = outagesOf(index)
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
      isFinal: true,
    });
  }
  return rollups;
}

/** Same wording as the incident engine uses for each type. */
function openedMessage(spec, cause) {
  if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) return `Heartbeat missing or failed: ${cause}`;
  if (typeOf(spec) === MONITOR_TYPES.AGENT) {
    return `Down after 3 consecutive failed reports or probes: ${cause}`;
  }
  return `Down after 3 consecutive failed checks: ${cause}`;
}

function recoveredMessage(spec) {
  if (typeOf(spec) === MONITOR_TYPES.HEARTBEAT) return 'Recovered: pings are arriving again';
  if (typeOf(spec) === MONITOR_TYPES.AGENT) return 'Recovered: agent reports are healthy again';
  return 'Recovered: checks are passing again';
}

function incidentsFor(monitor, index) {
  const spec = MONITORS[index];
  return outagesOf(index).map(([, agoMs, minutes, cause]) => {
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
    };
  });
}

/** The last hour of agent reports, so the agent page has charts straight away. */
function agentReports(monitor, index) {
  const spec = MONITORS[index];
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
    });
  }
  return reports;
}

/** This month's usage so far, as if the monitor had run since the 1st. */
function usageThisMonth(monitor, index) {
  const spec = MONITORS[index];
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
  };
}

/** The "last result" fields, plus what each push type needs to start out healthy. */
function liveFields(spec, last) {
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
}

async function main() {
  await connectMongo(env.MONGODB_URI);
  await ensureCollections();
  const { agenda, close: closeAgenda } = createAgenda({ mongoUri: env.MONGODB_URI, name: 'seed' });
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  const scheduler = createAgendaScheduler(agenda);

  await removePreviousDemo(scheduler);
  const secrets = await demoSecrets();

  const user = await User.create({
    name: 'Demo User',
    email: DEMO_EMAIL,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_COST),
  });
  const workspace = await createWorkspaceWithOwner({ name: 'Acme Inc.', ownerId: user._id });

  const monitors = await Monitor.insertMany(
    SEEDED.map((index) => MONITORS[index]).map((spec) => ({
      ...monitorDoc(spec, secrets),
      workspaceId: workspace._id,
      status: MONITOR_STATUS.PENDING,
    })),
  );

  for (const [position, monitor] of monitors.entries()) {
    const index = SEEDED[position];
    const spec = MONITORS[index];
    const checks = rawChecks(monitor, index);
    await CheckResult.insertMany(checks);
    await DailyRollup.insertMany(historicalRollups(monitor, index));
    await Incident.insertMany(incidentsFor(monitor, index));
    await MonitorUsage.create(usageThisMonth(monitor, index));
    if (typeOf(spec) === MONITOR_TYPES.AGENT) {
      await AgentReport.insertMany(agentReports(monitor, index));
    }

    // Start "up" with the latest backfilled result, so the dashboard looks alive at once.
    await Monitor.updateOne({ _id: monitor._id }, liveFields(spec, checks.at(-1)));
    // No-op for heartbeats; agent monitors only get a job with an external check.
    await scheduler.scheduleMonitor(monitor);
  }
  // Today's (and yesterday's) rollups from the raw checks, with the real rollup code.
  await rollupDay(new Date(now), { now: new Date(now) });
  await rollupDay(new Date(now - DAY_MS), { isFinal: true, now: new Date(now) });

  const channels = await AlertChannel.insertMany(
    alertChannelsFromEnv().map((channel) => ({ ...channel, workspaceId: workspace._id })),
  );

  const slugTaken = await StatusPage.exists({ slug: STATUS_SLUG });
  const statusPage = await StatusPage.create({
    workspaceId: workspace._id,
    slug: slugTaken ? `${STATUS_SLUG}-${workspace.slug.slice(-6)}` : STATUS_SLUG,
    title: 'Acme Status',
    description: 'Live availability of Acme Inc. services',
    monitorIds: monitors.map((monitor) => monitor._id),
    isPublic: true,
  });

  const heartbeatUrl = `${API_URL}/ping/${secrets.heartbeatToken}`;
  if (includeLocalDemo) {
    const agentSpec = MONITORS.find((spec) => typeOf(spec) === MONITOR_TYPES.AGENT);
    const demoFile = {
      agentKey: secrets.agentKey,
      endpoint: API_URL,
      // The demo-target's agent reports at the interval the monitor expects.
      reportEverySec: agentSpec.reportEverySec,
      heartbeatUrl,
    };
    writeFileSync(DEMO_FILE, `${JSON.stringify(demoFile, null, 2)}\n`);
  }

  await closeAgenda();
  await disconnectMongo();

  const kept = (reused) => (reused ? ' (kept from the previous seed)' : '');
  const demoLines = includeLocalDemo
    ? `  Demo target:    ${DEMO_TARGET_URL}  (control panel: ${DEMO_TARGET_URL.replace(/\/$/, '')}/admin)
  Agent key:      ${secrets.agentKey}${kept(secrets.reused.agentKey)}
  Agent endpoint: ${API_URL}
  Heartbeat URL:  ${heartbeatUrl}${kept(secrets.reused.heartbeatToken)}
  Written to:     ${DEMO_FILE} (git-ignored; the demo-target reads it)
Start everything with: npm run dev
Then start the heartbeat by hand: npm run heartbeat -w @pulseboard/demo-target`
    : `  Skipped the demo target, heartbeat and agent monitors: they need a local demo-target.
  Set SEED_LOCAL_DEMO=true to include them.`;
  console.warn(`
Seeded the demo account.
  Login:          ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  Workspace:      ${workspace.name} (${monitors.length} monitors, ${channels.length} alert channel${channels.length === 1 ? '' : 's'}: ${channels.map((c) => c.type).join(', ')})
  Status page:    /status/${statusPage.slug}
${demoLines}
`);
}

main().catch(async (err) => {
  console.error('Seeding failed:', err);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
