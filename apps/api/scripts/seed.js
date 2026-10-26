// npm run seed: creates a ready-to-demo account with realistic history.
//
//   login: demo@pulseboard.dev / demo1234
//   workspace "Acme Inc." with 4 monitors (the local demo-target + 3 public sites)
//   an alert channel (from SEED_* variables in .env, else an Ethereal test inbox)
//   a public status page at /status/acme
//   30 days of daily rollups, 24 hours of raw checks, and a few past incidents
//
// Safe to run again: the previous demo account and its data are removed first.
import { MONITOR_STATUS, ROLES } from '@pulseboard/shared/constants';
import { connectMongo, disconnectMongo, ensureCollections, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import {
  AlertChannel,
  CheckResult,
  DailyRollup,
  Incident,
  Membership,
  Monitor,
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
import { addDays, DAY_MS, utcDayStart } from '@pulseboard/shared/uptime';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  createWorkspaceWithOwner,
  deleteWorkspace,
} from '../src/modules/workspaces/workspaces.service.js';

loadEnv();
const env = parseEnv(
  z.object({
    MONGODB_URI: z.string().min(1),
    DEMO_MODE: z.enum(['true', 'false']).default('false'),
    DEMO_TARGET_PORT: z.coerce.number().default(4011),
    // Empty variables in .env mean "not set".
    SEED_DEMO_TARGET_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
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
const RAW_STEP_MS = 5 * 60 * 1000; // backfilled raw checks: one every 5 minutes for 24h
const now = Date.now();
const MIN = 60 * 1000;

/**
 * The 4 demo monitors. `latency` is the typical response time and `phases`
 * how it splits into DNS/TCP/TLS/TTFB/download (fractions), so the timing
 * breakdown chart looks like the real thing.
 */
const MONITORS = [
  {
    name: 'Checkout API (demo target)',
    url: env.SEED_DEMO_TARGET_URL ?? `http://localhost:${env.DEMO_TARGET_PORT}/`,
    intervalSec: env.DEMO_MODE === 'true' ? 10 : 30,
    timeoutMs: 5000,
    keyword: 'healthy',
    latency: 12,
    phases: [0.1, 0.1, 0, 0.75, 0.05],
  },
  {
    name: 'Google',
    url: 'https://www.google.com/',
    intervalSec: 60,
    latency: 110,
    phases: [0.15, 0.12, 0.2, 0.45, 0.08],
  },
  {
    name: 'GitHub',
    url: 'https://github.com/',
    intervalSec: 60,
    latency: 240,
    phases: [0.08, 0.1, 0.15, 0.5, 0.17],
  },
  {
    name: 'Example.com',
    url: 'https://example.com/',
    intervalSec: 60,
    latency: 150,
    phases: [0.12, 0.18, 0.25, 0.4, 0.05],
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
];

// Deterministic pseudo-random numbers, so every seed run looks the same.
let state = 42;
const random = () => {
  state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return state / 4_294_967_296;
};
const round1 = (value) => Math.round(value * 10) / 10;

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

/** 24 hours of raw checks (one per 5 min), consistent with today's outage. */
function rawChecks(monitor, index) {
  const spec = MONITORS[index];
  const checks = [];
  for (let t = now - DAY_MS + RAW_STEP_MS; t <= now; t += RAW_STEP_MS) {
    const down = isDuringOutage(index, t);
    const wave = 1 + 0.25 * Math.sin((t / DAY_MS) * 2 * Math.PI); // busier in the daytime
    const totalMs = round1(spec.latency * wave * (0.85 + random() * 0.3));
    const [dns, tcp, tls, ttfb, download] = spec.phases.map((share) => round1(totalMs * share));
    checks.push({
      timestamp: new Date(t),
      meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
      ok: !down,
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
  const checksPerDay = Math.round(DAY_MS / (spec.intervalSec * 1000));
  const today = utcDayStart(now);
  const rollups = [];
  for (let d = 1; d <= HISTORY_DAYS; d += 1) {
    const date = addDays(today, -d);
    const dayEnd = addDays(date, 1).getTime();
    const downtimeSec = outagesOf(index)
      .map(([, agoMs, minutes]) => [now - agoMs, now - agoMs + minutes * MIN])
      .filter(([start]) => start >= date.getTime() && start < dayEnd)
      .reduce((sum, [start, end]) => sum + (end - start) / 1000, 0);
    const failed = Math.round(downtimeSec / spec.intervalSec) + (random() < 0.15 ? 1 : 0);
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

function incidentsFor(monitor, index) {
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
          message: `Down after 3 consecutive failed checks: ${cause}`,
        },
        {
          at: new Date(startedAt.getTime() + 2 * MIN + 2000),
          type: 'alert_sent',
          message: 'Down alerts sent to all enabled channels',
        },
        { at: resolvedAt, type: 'resolved', message: 'Recovered: checks are passing again' },
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

async function main() {
  await connectMongo(env.MONGODB_URI);
  await ensureCollections();
  const { agenda, close: closeAgenda } = createAgenda({ mongoUri: env.MONGODB_URI, name: 'seed' });
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  const scheduler = createAgendaScheduler(agenda);

  await removePreviousDemo(scheduler);

  const user = await User.create({
    name: 'Demo User',
    email: DEMO_EMAIL,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_COST),
  });
  const workspace = await createWorkspaceWithOwner({ name: 'Acme Inc.', ownerId: user._id });

  const monitors = await Monitor.insertMany(
    MONITORS.map(({ latency: _latency, phases: _phases, ...spec }) => ({
      ...spec,
      workspaceId: workspace._id,
      status: MONITOR_STATUS.PENDING,
    })),
  );

  for (const [index, monitor] of monitors.entries()) {
    const checks = rawChecks(monitor, index);
    await CheckResult.insertMany(checks);
    await DailyRollup.insertMany(historicalRollups(monitor, index));
    await Incident.insertMany(incidentsFor(monitor, index));

    // Start "up" with the latest backfilled check, so the dashboard looks alive at once.
    const last = checks.at(-1);
    await Monitor.updateOne(
      { _id: monitor._id },
      {
        status: MONITOR_STATUS.UP,
        consecutiveSuccesses: 1,
        lastCheckedAt: last.timestamp,
        lastResponseMs: last.totalMs,
        lastOk: last.ok,
        lastStatusCode: last.statusCode,
        lastTimings: last.timings,
      },
    );
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

  await closeAgenda();
  await disconnectMongo();

  console.warn(`
Seeded the demo account.
  Login:        ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  Workspace:    ${workspace.name} (${monitors.length} monitors, ${channels.length} alert channel${channels.length === 1 ? '' : 's'}: ${channels.map((c) => c.type).join(', ')})
  Status page:  /status/${statusPage.slug}
  Demo target:  ${MONITORS[0].url}  (control panel: ${MONITORS[0].url.replace(/\/$/, '')}/admin)
Start everything with: npm run dev
`);
}

main().catch(async (err) => {
  console.error('Seeding failed:', err);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
