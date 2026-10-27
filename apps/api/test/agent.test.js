import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { JOB_NAMES } from '@pulseboard/shared/constants';
import {
  AgentReport,
  AlertChannel,
  CheckResult,
  Incident,
  Monitor,
  MonitorUsage,
} from '@pulseboard/shared/models';
import { AGENDA_COLLECTION, createAgenda } from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

/** Records scheduler calls: agent monitors only get a check job with an external check. */
function fakeScheduler() {
  const calls = [];
  return {
    calls,
    async scheduleMonitor(monitor) {
      calls.push(['schedule', String(monitor._id)]);
    },
    async cancelMonitor(monitorId) {
      calls.push(['cancel', String(monitorId)]);
    },
  };
}

const scheduler = fakeScheduler();
let app, closeAgenda, target, targetUrl;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  const { agenda, close } = createAgenda({
    mongoUri: replSet.getUri('pulseboard-test'),
    name: 'api-agent-test',
  });
  closeAgenda = close;
  app = buildTestApp({ scheduler, agenda, env: { DEMO_MODE: false } });
  // A local endpoint for "Test now" on the probe URL.
  target = createServer((_req, res) => res.writeHead(200).end());
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${target.address().port}/health`;
});

afterAll(async () => {
  await new Promise((resolve) => target.close(resolve));
  await closeAgenda?.();
  await stopMemoryDb();
});

let owner, viewer, wid;
const monitorsUrl = (path = '') => `/api/v1/workspaces/${wid}/monitors${path}`;
const REPORT_URL = '/api/v1/agent/report';

beforeEach(async () => {
  await clearMemoryDb();
  scheduler.calls.length = 0;
  owner = await registerUser(app, { name: 'Owner' });
  viewer = await registerUser(app, { name: 'Viewer' });
  wid = owner.workspaceId;
  await request(app)
    .post(`/api/v1/workspaces/${wid}/members`)
    .set(owner.auth)
    .send({ email: viewer.user.email, role: 'viewer' });
});

async function createAgent(body = {}) {
  const res = await request(app)
    .post(monitorsUrl())
    .set(owner.auth)
    .send({ type: 'agent', name: 'Shop API', ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

function reportBody(overrides = {}) {
  const end = new Date();
  return {
    windowStart: new Date(end - 60_000).toISOString(),
    windowEnd: end.toISOString(),
    requests: 1000,
    errors5xx: 3,
    errors4xx: 17,
    p50Ms: 12.4,
    p95Ms: 88.1,
    p99Ms: 240.3,
    topRoutes: [{ route: '/api/orders/:id', requests: 410, errors5xx: 1, p95Ms: 95.2 }],
    agentVersion: '1.0.0',
    hostname: 'web-1',
    uptimeSec: 86400,
    ...overrides,
  };
}

const report = (key, body = reportBody()) =>
  request(app).post(REPORT_URL).set('Authorization', `Bearer ${key}`).send(body);

describe('creating an agent monitor', () => {
  it('returns the key once, stores only its hash, and schedules nothing by default', async () => {
    const monitor = await createAgent();
    expect(monitor).toMatchObject({
      type: 'agent',
      name: 'Shop API',
      reportEverySec: 60,
      errorRateThreshold: 5,
      status: 'pending',
      silenceState: 'reporting',
    });
    expect(monitor.agentKey).toMatch(/^pbk_[A-Za-z0-9_-]{32}$/);
    expect(monitor.agentKeyPrefix).toBe(monitor.agentKey.slice(0, 8));
    expect(monitor).not.toHaveProperty('agentKeyHash');

    const stored = await Monitor.findById(monitor.id).lean();
    expect(stored.agentKeyHash).toBe(createHash('sha256').update(monitor.agentKey).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(monitor.agentKey);
    expect(scheduler.calls).toEqual([]);

    // Never readable again, not even by the owner.
    const again = await request(app)
      .get(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth);
    expect(again.body.data).not.toHaveProperty('agentKey');
    expect(again.body.data).not.toHaveProperty('agentKeyHash');
    expect(again.body.data.agentKeyPrefix).toBe(monitor.agentKeyPrefix);
  });

  it('validates settings; an external check needs a probe URL and gets a check job', async () => {
    const bad = await request(app)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ type: 'agent', name: 'X', reportEverySec: 10, errorRateThreshold: 101 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(['reportEverySec', 'errorRateThreshold']),
    );

    const noProbe = await request(app)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ type: 'agent', name: 'X', externalCheckEverySec: 900 });
    expect(noProbe.status).toBe(400);
    expect(noProbe.body.error.details).toEqual([
      { path: 'probeUrl', message: 'An external check needs a probe URL' },
    ]);

    const monitor = await createAgent({ probeUrl: targetUrl, externalCheckEverySec: 900 });
    expect(scheduler.calls).toEqual([['schedule', monitor.id]]);
  });

  it('PATCH edits agent settings, (un)schedules the external check, keeps the type', async () => {
    const monitor = await createAgent();
    const on = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ probeUrl: targetUrl, externalCheckEverySec: 1800, p95ThresholdMs: 500 });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ externalCheckEverySec: 1800, p95ThresholdMs: 500 });
    expect(on.body.data).not.toHaveProperty('agentKey');
    expect(scheduler.calls.at(-1)).toEqual(['schedule', monitor.id]);

    const off = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ externalCheckEverySec: '' });
    expect(off.status).toBe(200);
    expect(off.body.data.externalCheckEverySec).toBeNull();
    expect(scheduler.calls.at(-1)).toEqual(['cancel', monitor.id]);

    const type = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ type: 'http' });
    expect(type.status).toBe(400);
  });
});

describe('POST /agent/report', () => {
  it('rejects a missing or unknown key with 401', async () => {
    await createAgent();
    const missing = await request(app).post(REPORT_URL).send(reportBody());
    expect(missing.status).toBe(401);
    const wrong = await report('pbk_notARealKeyAtAllxxxxxxxxxxxxxxxxxx');
    expect(wrong.status).toBe(401);
    expect(await CheckResult.countDocuments()).toBe(0);
  });

  it('records a report: 202, AgentReport, CheckResult (agent), usage, monitor up', async () => {
    const monitor = await createAgent();
    const res = await report(monitor.agentKey);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });

    const [stored] = await AgentReport.find().lean();
    expect(stored).toMatchObject({ requests: 1000, errors5xx: 3, hostname: 'web-1' });
    expect(stored.topRoutes[0]).toMatchObject({ route: '/api/orders/:id', requests: 410 });
    const [check] = await CheckResult.find().lean();
    expect(check).toMatchObject({ ok: true, source: 'agent', totalMs: 12.4 });
    const usage = await MonitorUsage.findOne({ monitorId: monitor.id }).lean();
    expect(usage.reports).toBe(1);
    expect(usage.requests).toBe(0);

    const fresh = await Monitor.findById(monitor.id).lean();
    expect(fresh.status).toBe('up');
    expect(fresh.lastReportAt).toBeInstanceOf(Date);
    expect(fresh.silenceState).toBe('reporting');
  });

  it('validates the body (400) only for a valid key', async () => {
    const monitor = await createAgent();
    const bad = await report(monitor.agentKey, { requests: -1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const inconsistent = await report(monitor.agentKey, reportBody({ requests: 1, errors5xx: 5 }));
    expect(inconsistent.status).toBe(400);
  });

  it('a regenerated key works at once and the old key gets 401 (members only)', async () => {
    const monitor = await createAgent();
    const denied = await request(app)
      .post(monitorsUrl(`/${monitor.id}/agent-key`))
      .set(viewer.auth);
    expect(denied.status).toBe(403);

    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/agent-key`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    const newKey = res.body.data.agentKey;
    expect(newKey).toMatch(/^pbk_/);
    expect(newKey).not.toBe(monitor.agentKey);
    expect(res.body.data.agentKeyPrefix).toBe(newKey.slice(0, 8));

    expect((await report(monitor.agentKey)).status).toBe(401);
    expect((await report(newKey)).status).toBe(202);
  });

  it('rate-limits each key separately (30 per minute)', async () => {
    const limited = await createAgent({ name: 'Busy' });
    const other = await createAgent({ name: 'Calm' });
    const body = reportBody({ topRoutes: [] });
    for (let i = 0; i < 30; i += 1) {
      expect((await report(limited.agentKey, body)).status).toBe(202);
    }
    const res = await report(limited.agentKey, body);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect((await report(other.agentKey, body)).status).toBe(202);
  });

  it('3 reports above the error-rate threshold open an incident, 2 good ones resolve it', async () => {
    const monitor = await createAgent();
    await AlertChannel.create({
      workspaceId: wid,
      name: 'Discord',
      type: 'discord',
      target: 'https://discord.com/api/webhooks/1/abc',
    });
    const bad = reportBody({ requests: 1000, errors5xx: 82 });
    await report(monitor.agentKey, reportBody()); // pending -> up
    await report(monitor.agentKey, bad);
    await report(monitor.agentKey, bad);
    expect(await Incident.countDocuments()).toBe(0); // 2 failures: not yet
    await report(monitor.agentKey, bad);

    const incident = await Incident.findOne({ monitorId: monitor.id }).lean();
    expect(incident).toMatchObject({ cause: 'Error rate 8.2 % above 5 %', resolvedAt: null });
    expect((await Monitor.findById(monitor.id).lean()).status).toBe('down');
    const alerts = await mongoose.connection.db
      .collection(AGENDA_COLLECTION)
      .find({ name: JOB_NAMES.SEND_ALERT })
      .toArray();
    expect(alerts.map((job) => job.data.kind)).toEqual(['down']);

    await report(monitor.agentKey, reportBody());
    expect((await Monitor.findById(monitor.id).lean()).status).toBe('down');
    await report(
      monitor.agentKey,
      reportBody({
        requests: 0,
        errors5xx: 0,
        errors4xx: 0,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        topRoutes: [],
      }),
    );
    const resolved = await Incident.findById(incident._id).lean();
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect((await Monitor.findById(monitor.id).lean()).status).toBe('up');
  });

  it('a p95 above the threshold is a failure too', async () => {
    const monitor = await createAgent({ p95ThresholdMs: 50 });
    await report(monitor.agentKey);
    const [check] = await CheckResult.find().lean();
    expect(check).toMatchObject({ ok: false, error: 'p95 88.1 ms above 50 ms' });
  });

  it('a report ends a silence: degraded -> up, silenceState back to reporting', async () => {
    const monitor = await createAgent();
    await Monitor.updateOne(
      { _id: monitor.id },
      { status: 'degraded', silenceState: 'silent', silentNoticeAt: new Date() },
    );
    await report(monitor.agentKey);
    const fresh = await Monitor.findById(monitor.id).lean();
    expect(fresh).toMatchObject({ status: 'up', silenceState: 'reporting', silentNoticeAt: null });
  });

  it('ignores reports for a paused monitor', async () => {
    const monitor = await createAgent();
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    const res = await report(monitor.agentKey);
    expect(res.status).toBe(202);
    expect(await CheckResult.countDocuments()).toBe(0);
  });
});

describe('agent metrics, usage and Test now', () => {
  it('viewers read metrics: points, aggregated top routes, last report', async () => {
    const monitor = await createAgent();
    await report(monitor.agentKey, reportBody({ requests: 200, errors5xx: 10 }));
    await report(
      monitor.agentKey,
      reportBody({
        hostname: 'web-2',
        topRoutes: [
          { route: '/api/orders/:id', requests: 90, errors5xx: 2, p95Ms: 120 },
          { route: '/health', requests: 500, errors5xx: 0, p95Ms: 2 },
        ],
      }),
    );

    const res = await request(app)
      .get(monitorsUrl(`/${monitor.id}/agent-metrics`))
      .set(viewer.auth);
    expect(res.status).toBe(200);
    const { points, topRoutes, lastReport } = res.body.data;
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ requests: 200, errors5xx: 10, errorRate: 5, p95Ms: 88.1 });
    expect(Object.keys(points[0]).sort()).toEqual(
      ['errorRate', 'errors4xx', 'errors5xx', 'p50Ms', 'p95Ms', 'p99Ms', 'requests', 't'].sort(),
    );
    expect(topRoutes).toEqual(
      [
        { route: '/health', requests: 500, errors5xx: 0, p95Ms: 2 },
        { route: '/api/orders/:id', requests: 500, errors5xx: 3, p95Ms: 120 },
      ].sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route)),
    );
    expect(lastReport).toMatchObject({
      hostname: 'web-2',
      agentVersion: '1.0.0',
      uptimeSec: 86400,
    });

    const tooLong = await request(app)
      .get(monitorsUrl(`/${monitor.id}/agent-metrics`))
      .query({ from: new Date(Date.now() - 25 * 3600_000).toISOString() })
      .set(viewer.auth);
    expect(tooLong.status).toBe(400);
  });

  it('downsamples to at most 500 points', async () => {
    const monitor = await createAgent();
    const now = Date.now();
    await AgentReport.insertMany(
      Array.from({ length: 720 }, (_, i) => ({
        windowStart: new Date(now - i * 4900 - 5000),
        windowEnd: new Date(now - i * 4900 - 1000),
        meta: { monitorId: monitor.id, workspaceId: wid },
        requests: 10,
        errors5xx: 1,
        errors4xx: 0,
        p50Ms: 10,
        p95Ms: 20 + (i % 7),
        p99Ms: 30,
      })),
    );
    const res = await request(app)
      .get(monitorsUrl(`/${monitor.id}/agent-metrics`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    const { points, downsampled } = res.body.data;
    expect(downsampled).toBe(true);
    expect(points.length).toBeLessThanOrEqual(500);
    expect(points.reduce((sum, p) => sum + p.requests, 0)).toBe(7200);
    expect(points.every((p) => p.errorRate === 10)).toBe(true);
  });

  it('usage adds reports received and requests saved vs 1-minute polling', async () => {
    const plain = await createAgent();
    await report(plain.agentKey);
    await report(plain.agentKey);
    const usage = await request(app)
      .get(monitorsUrl(`/${plain.id}/usage`))
      .set(viewer.auth);
    expect(usage.body.data).toMatchObject({ reports: 2, requests: 0, requestsSaved: 43_200 });

    const external = await createAgent({ probeUrl: targetUrl, externalCheckEverySec: 900 });
    const res = await request(app)
      .get(monitorsUrl(`/${external.id}/usage`))
      .set(viewer.auth);
    expect(res.body.data).toMatchObject({ estimatedMonthly: 2880, requestsSaved: 40_320 });
  });

  it('Test now checks the probe URL, or says it is not supported without one', async () => {
    const plain = await createAgent();
    const unsupported = await request(app)
      .post(monitorsUrl(`/${plain.id}/test`))
      .set(owner.auth);
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('NOT_SUPPORTED');

    const probed = await createAgent({ probeUrl: targetUrl });
    const res = await request(app)
      .post(monitorsUrl(`/${probed.id}/test`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, statusCode: 200, requestsSent: 1 });
    const usage = await MonitorUsage.findOne({ monitorId: probed.id }).lean();
    expect(usage.requests).toBe(1);
  });

  it('viewers see agent monitors without key material', async () => {
    const monitor = await createAgent();
    const res = await request(app)
      .get(monitorsUrl(`/${monitor.id}`))
      .set(viewer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('agentKeyHash');
    expect(res.body.data).not.toHaveProperty('agentKey');
  });

  it('resume restarts the silence clock', async () => {
    const monitor = await createAgent();
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    const before = Date.now();
    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/resume`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'pending', silenceState: 'reporting' });
    expect(new Date(res.body.data.watchSince).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('deleting the monitor deletes its reports', async () => {
    const monitor = await createAgent();
    await report(monitor.agentKey);
    await request(app)
      .delete(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth);
    expect(await AgentReport.countDocuments()).toBe(0);
  });
});
