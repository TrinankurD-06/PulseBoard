import { createServer } from 'node:http';
import { runHttpCheck } from '@pulseboard/shared/check';
import { CHECK_SOURCES, JOB_NAMES } from '@pulseboard/shared/constants';
import { createIncidentEngine, thresholdsFor } from '@pulseboard/shared/incident';
import { createLogger } from '@pulseboard/shared/logger';
import {
  AlertChannel,
  CheckResult,
  DailyRollup,
  Incident,
  Monitor,
} from '@pulseboard/shared/models';
import { rollupDay } from '@pulseboard/shared/rollup';
import { AGENDA_COLLECTION, createAgenda } from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { uptimeFromDowntime } from '@pulseboard/shared/uptime';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

// U5: the same guarantees for all three monitor types. Each type reaches the
// shared code through its real entry point: http through runHttpCheck + the
// incident engine (what the worker's check job does), heartbeat through the
// ping endpoint, agent through the report endpoint. Everything downstream
// (uptime, rollups, the 90-day series, public pages, incidents and alerts)
// must then behave the same.

const scheduler = { async scheduleMonitor() {}, async cancelMonitor() {} };
let app, closeAgenda, processCheckResult, target, targetUrl;
let healthy = true;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  const { agenda, close } = createAgenda({
    mongoUri: replSet.getUri('pulseboard-test'),
    name: 'api-cross-type-test',
  });
  closeAgenda = close;
  app = buildTestApp({ scheduler, agenda, env: { DEMO_MODE: false } });
  processCheckResult = createIncidentEngine({ agenda, logger: createLogger({ name: 'cross' }) });
  target = createServer((_req, res) => res.writeHead(healthy ? 200 : 503).end());
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${target.address().port}/internal/health`;
});

afterAll(async () => {
  await new Promise((resolve) => target.close(resolve));
  await closeAgenda?.();
  await stopMemoryDb();
});

let owner, wid, enabledChannel;
const ws = (path) => `/api/v1/workspaces/${wid}${path}`;

beforeEach(async () => {
  await clearMemoryDb();
  healthy = true;
  owner = await registerUser(app, { name: 'Owner' });
  wid = owner.workspaceId;
  enabledChannel = await AlertChannel.create({
    workspaceId: wid,
    name: 'ops',
    type: 'discord',
    target: 'https://discord.com/api/webhooks/1/enabled',
  });
  await AlertChannel.create({
    workspaceId: wid,
    name: 'muted',
    type: 'slack',
    target: 'https://hooks.slack.com/services/T/B/muted',
    isEnabled: false,
  });
});

async function createMonitor(body) {
  const res = await request(app).post(ws('/monitors')).set(owner.auth).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

function agentReport({ ok }) {
  const end = new Date();
  return {
    windowStart: new Date(end - 30_000).toISOString(),
    windowEnd: end.toISOString(),
    requests: 200,
    errors5xx: ok ? 0 : 150,
    errors4xx: 0,
    p50Ms: 12,
    p95Ms: 40,
    p99Ms: 80,
    topRoutes: [{ route: '/api/orders/:id', requests: 200, errors5xx: ok ? 0 : 150, p95Ms: 40 }],
  };
}

/**
 * One driver per type: create() makes the monitor (returning anything secret
 * it was given, for the leak check), and check(ok) feeds one good or bad
 * result through the type's real entry point.
 */
const DRIVERS = {
  http: {
    async create() {
      const monitor = await createMonitor({
        name: 'Website',
        url: targetUrl,
        method: 'GET',
        intervalSec: 60,
      });
      return { monitor, secrets: [targetUrl] };
    },
    async check(monitor, ok) {
      healthy = ok;
      const stored = await Monitor.findById(monitor.id).lean();
      const result = await runHttpCheck(stored, { allowPrivate: true });
      const checkedAt = new Date();
      await CheckResult.create({
        timestamp: checkedAt,
        meta: { monitorId: stored._id, workspaceId: stored.workspaceId },
        ok: result.ok,
        statusCode: result.statusCode,
        error: result.error,
        totalMs: result.totalMs,
        timings: result.timings,
        source: CHECK_SOURCES.HTTP,
      });
      await processCheckResult(stored._id, result, checkedAt);
    },
  },
  heartbeat: {
    async create() {
      const monitor = await createMonitor({
        type: 'heartbeat',
        name: 'Nightly backup',
        expectedEverySec: 3600,
      });
      return { monitor, secrets: [monitor.heartbeatToken] };
    },
    async check(monitor, ok) {
      const path = `/api/v1/ping/${monitor.heartbeatToken}${ok ? '' : '/fail'}`;
      const res = await request(app).get(`${path}?message=pg_dump%20at%2010.0.0.5%20failed`);
      expect(res.status).toBe(200);
    },
  },
  agent: {
    async create() {
      const monitor = await createMonitor({
        type: 'agent',
        name: 'Checkout API',
        reportEverySec: 30,
        probeUrl: targetUrl,
      });
      const stored = await Monitor.findById(monitor.id).lean();
      return { monitor, secrets: [monitor.agentKey, stored.agentKeyHash, targetUrl] };
    },
    async check(monitor, ok) {
      const res = await request(app)
        .post('/api/v1/agent/report')
        .set('Authorization', `Bearer ${monitor.agentKey}`)
        .send(agentReport({ ok }));
      expect(res.status).toBe(202);
    },
  },
};

const alertJobs = () =>
  mongoose.connection.db
    .collection(AGENDA_COLLECTION)
    .find({ name: JOB_NAMES.SEND_ALERT })
    .toArray();

/**
 * up -> enough failures to open an incident -> enough successes to resolve it.
 * Returns how many checks were good and bad.
 */
async function runOutage(driver, monitor, type) {
  const { failure, recovery } = thresholdsFor(type);
  await driver.check(monitor, true);
  expect((await Monitor.findById(monitor.id).lean()).status).toBe('up');

  for (let i = 1; i <= failure; i += 1) {
    expect(await Incident.countDocuments({ monitorId: monitor.id })).toBe(0);
    await driver.check(monitor, false);
  }
  const open = await Incident.findOne({ monitorId: monitor.id }).lean();
  expect(open).toMatchObject({ resolvedAt: null });
  expect((await Monitor.findById(monitor.id).lean()).status).toBe('down');

  for (let i = 1; i <= recovery; i += 1) await driver.check(monitor, true);
  return { up: 1 + recovery, down: failure };
}

describe.each(Object.keys(DRIVERS))('%s monitors', (type) => {
  const driver = DRIVERS[type];

  it('open and resolve one incident, alerting only enabled channels', async () => {
    const { monitor } = await driver.create();
    await runOutage(driver, monitor, type);

    const incidents = await Incident.find({ monitorId: monitor.id }).lean();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].resolvedAt).toBeInstanceOf(Date);
    expect((await Monitor.findById(monitor.id).lean()).status).toBe('up');

    const jobs = await alertJobs();
    expect(jobs.map((job) => job.data.kind).sort()).toEqual(['down', 'up']);
    for (const job of jobs) {
      expect(job.data).toMatchObject({
        incidentId: String(incidents[0]._id),
        channelId: String(enabledChannel._id),
        attempt: 1,
      });
    }
  });

  it('records results with its source, and they count towards uptime, rollups and the 90-day series', async () => {
    const { monitor } = await driver.create();
    const { up, down } = await runOutage(driver, monitor, type);

    const results = await CheckResult.find({ 'meta.monitorId': monitor.id }).lean();
    expect(results).toHaveLength(up + down);
    expect(new Set(results.map((result) => result.source))).toEqual(new Set([type]));

    const uptime = await request(app)
      .get(ws(`/monitors/${monitor.id}/uptime`))
      .set(owner.auth);
    // Uptime is confirmed downtime over watched time, never the pass rate: the incident
    // lasted milliseconds and nothing was watched for a full second yet, so this is
    // 'no data' or 100, and in particular not up / (up + down).
    expect([null, 100]).toContain(uptime.body.data.h24);

    // An hour later (a fixed clock keeps the covered time well above zero).
    await rollupDay(new Date(), { now: LATER() });
    const rollup = await DailyRollup.findOne({ monitorId: monitor.id }).lean();
    expect(rollup).toMatchObject({ totalChecks: up + down, upChecks: up });
    expect(rollup.coveredSec).toBeGreaterThanOrEqual(3600);
    expect(rollup.coveredSec).toBeLessThan(3700);
    expect(rollup.downtimeSec).toBeLessThanOrEqual(1);

    const daily = await request(app)
      .get(ws(`/monitors/${monitor.id}/daily?days=90`))
      .set(owner.auth);
    expect(daily.status).toBe(200);
    const days = daily.body.data;
    expect(days).toHaveLength(90);
    expect(days.at(-1)).toMatchObject({ totalChecks: up + down });
    // Downtime over covered time, the same as the rollup says: the failed checks changed nothing.
    expect(days.at(-1).uptime).toBe(uptimeFromDowntime(rollup.downtimeSec, rollup.coveredSec));
    expect(days.at(-1).uptime).toBeGreaterThan(99.9);
    expect(days.slice(0, -1).every((day) => day.totalChecks === 0)).toBe(true);
  });

  it('shows on a public status page without leaking anything', async () => {
    const { monitor, secrets } = await driver.create();
    await runOutage(driver, monitor, type);
    await rollupDay(new Date(), { now: LATER() });
    const page = await request(app)
      .post(ws('/status-pages'))
      .set(owner.auth)
      .send({ title: 'Acme', slug: `acme-${type}`, monitorIds: [monitor.id] });
    expect(page.status).toBe(201);

    const res = await request(app).get(`/api/v1/public/status/acme-${type}`);

    expect(res.status).toBe(200);
    const [entry] = res.body.data.monitors;
    expect(Object.keys(entry).sort()).toEqual(['days', 'name', 'status', 'uptime90']);
    expect(entry).toMatchObject({ name: monitor.name, status: 'up' });
    expect(entry.days).toHaveLength(90);
    expect(entry.days.at(-1).totalChecks).toBeGreaterThan(0);
    expect(res.body.data.incidents).toHaveLength(1);
    expect(res.body.data.incidents[0].monitorName).toBe(monitor.name);

    const body = JSON.stringify(res.body);
    const stored = await Monitor.findById(monitor.id).lean();
    for (const secret of [...secrets, monitor.id, wid, String(stored.workspaceId)]) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toMatch(/127\.0\.0\.1|10\.0\.0\.5|pg_dump|heartbeatToken|agentKey|probeUrl/);
  });
});

/** An hour from now: lets rollups cover a real span of time instead of milliseconds. */
const LATER = () => new Date(Date.now() + 60 * 60 * 1000);

describe('all three types together', () => {
  it('appear side by side on one status page with the same public shape', async () => {
    const created = {};
    for (const [type, driver] of Object.entries(DRIVERS)) {
      created[type] = (await driver.create()).monitor;
      await driver.check(created[type], true);
    }
    await rollupDay(new Date(), { now: LATER() });
    await request(app)
      .post(ws('/status-pages'))
      .set(owner.auth)
      .send({
        title: 'Everything',
        slug: 'everything',
        monitorIds: Object.values(created).map((monitor) => monitor.id),
      });

    const res = await request(app).get('/api/v1/public/status/everything');

    expect(res.body.data.overall).toBe('operational');
    expect(res.body.data.monitors.map((entry) => entry.name)).toEqual([
      'Website',
      'Nightly backup',
      'Checkout API',
    ]);
    for (const entry of res.body.data.monitors) {
      expect(entry).toMatchObject({ status: 'up', uptime90: 100 });
      expect(entry.days.at(-1)).toMatchObject({ totalChecks: 1, uptime: 100 });
    }
  });
});
