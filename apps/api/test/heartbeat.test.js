import { JOB_NAMES } from '@pulseboard/shared/constants';
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
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

/** Records scheduler calls: heartbeats must never get a check job. */
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
// The API's real (never started) Agenda, used only to queue send-alert jobs.
let app, closeAgenda;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  const { agenda, close } = createAgenda({
    mongoUri: replSet.getUri('pulseboard-test'),
    name: 'api-test',
  });
  closeAgenda = close;
  app = buildTestApp({ scheduler, agenda, env: { DEMO_MODE: false } });
});

afterAll(async () => {
  await closeAgenda?.();
  await stopMemoryDb();
});

let owner, viewer, wid;
const monitorsUrl = (path = '') => `/api/v1/workspaces/${wid}/monitors${path}`;
const ping = (token, path = '') => `/api/v1/ping/${token}${path}`;
const MASK = '••••••';

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

async function createHeartbeat(body = {}) {
  const res = await request(app)
    .post(monitorsUrl())
    .set(owner.auth)
    .send({ type: 'heartbeat', name: 'Nightly backup', expectedEverySec: 3600, ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

const alertJobs = () =>
  mongoose.connection.db
    .collection(AGENDA_COLLECTION)
    .find({ name: JOB_NAMES.SEND_ALERT })
    .toArray();

describe('creating a heartbeat monitor', () => {
  it('needs no URL, gets a secret token and a due time, and no check job', async () => {
    const before = Date.now();
    const monitor = await createHeartbeat();
    expect(monitor).toMatchObject({
      type: 'heartbeat',
      name: 'Nightly backup',
      expectedEverySec: 3600,
      graceSec: 60,
      status: 'pending',
    });
    expect(monitor.heartbeatToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dueIn = new Date(monitor.nextDueAt) - before;
    expect(dueIn).toBeGreaterThanOrEqual(3660 * 1000);
    expect(dueIn).toBeLessThan(3670 * 1000);
    expect(scheduler.calls).toEqual([]);
  });

  it('rejects invalid heartbeat settings and unknown types', async () => {
    const tooShort = await request(app)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ type: 'heartbeat', name: 'Job', expectedEverySec: 5 });
    expect(tooShort.status).toBe(400);
    const unknown = await request(app)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ type: 'ftp', name: 'Job' }); // 'agent' became valid in U4
    expect(unknown.status).toBe(400);
  });

  it('masks the token for viewers, in the list and in the detail', async () => {
    const monitor = await createHeartbeat();
    const detail = await request(app)
      .get(monitorsUrl(`/${monitor.id}`))
      .set(viewer.auth);
    expect(detail.body.data.heartbeatToken).toBe(MASK);
    const list = await request(app).get(monitorsUrl()).set(viewer.auth);
    expect(list.body.data[0].heartbeatToken).toBe(MASK);
    const mine = await request(app)
      .get(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth);
    expect(mine.body.data.heartbeatToken).toBe(monitor.heartbeatToken);
  });
});

describe('ping endpoints', () => {
  it('a success ping marks it up, stores a heartbeat check and counts the ping', async () => {
    const monitor = await createHeartbeat();
    const res = await request(app).get(ping(monitor.heartbeatToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const stored = await Monitor.findById(monitor.id).lean();
    expect(stored.status).toBe('up');
    expect(stored.lastPingAt).toBeInstanceOf(Date);
    expect(stored.nextDueAt - stored.lastPingAt).toBe(3660 * 1000);
    expect(stored.lastOk).toBe(true);

    const checks = await CheckResult.find({ 'meta.monitorId': stored._id }).lean();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ ok: true, source: 'heartbeat', totalMs: null });

    const usage = await request(app)
      .get(monitorsUrl(`/${monitor.id}/usage`))
      .set(viewer.auth);
    expect(usage.body.data).toMatchObject({ pings: 1, requests: 0, estimatedMonthly: 0 });
  });

  it('POST works too, and the response says nothing about the monitor', async () => {
    const monitor = await createHeartbeat();
    const res = await request(app).post(ping(monitor.heartbeatToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('a fail ping opens an incident at once and queues alerts on the real Agenda', async () => {
    const monitor = await createHeartbeat();
    await AlertChannel.create({
      workspaceId: wid,
      name: 'ops',
      type: 'discord',
      target: 'https://discord.com/api/webhooks/1/a',
    });
    await request(app).get(ping(monitor.heartbeatToken)); // up
    const res = await request(app)
      .post(ping(monitor.heartbeatToken, '/fail'))
      .send({ message: 'pg_dump: connection refused' });
    expect(res.body).toEqual({ ok: true });

    const stored = await Monitor.findById(monitor.id).lean();
    expect(stored).toMatchObject({ status: 'down', lastError: 'pg_dump: connection refused' });
    const incident = await Incident.findOne({ monitorId: stored._id }).lean();
    expect(incident.cause).toBe('pg_dump: connection refused');
    expect(incident.resolvedAt).toBeNull();

    const jobs = await alertJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ incidentId: String(incident._id), kind: 'down' });

    // One good ping resolves it.
    await request(app).get(ping(monitor.heartbeatToken));
    const resolved = await Incident.findById(incident._id).lean();
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect((await Monitor.findById(monitor.id).lean()).status).toBe('up');
    expect((await alertJobs()).map((job) => job.data.kind).sort()).toEqual(['down', 'up']);
  });

  it('takes the failure message from the query string, else a default', async () => {
    const monitor = await createHeartbeat();
    await request(app).get(`${ping(monitor.heartbeatToken, '/fail')}?message=disk%20full`);
    expect((await Monitor.findById(monitor.id).lean()).lastError).toBe('disk full');
    await request(app).get(ping(monitor.heartbeatToken, '/fail'));
    expect((await Monitor.findById(monitor.id).lean()).lastError).toBe(
      'Failure reported by the job',
    );
  });

  it('/start then a ping records the run duration', async () => {
    const monitor = await createHeartbeat();
    const start = await request(app).get(ping(monitor.heartbeatToken, '/start'));
    expect(start.body).toEqual({ ok: true });
    // A start alone is not a check.
    expect(await CheckResult.countDocuments()).toBe(0);
    // Pretend the job started 5 s ago.
    await Monitor.updateOne(
      { _id: monitor.id },
      { $set: { lastStartAt: new Date(Date.now() - 5000) } },
    );
    await request(app).get(ping(monitor.heartbeatToken));

    const [check] = await CheckResult.find().lean();
    expect(check.totalMs).toBeGreaterThanOrEqual(5000);
    expect(check.totalMs).toBeLessThan(10_000);
    expect((await Monitor.findById(monitor.id).lean()).lastResponseMs).toBe(check.totalMs);

    // The next ping without a new /start has no duration.
    await request(app).get(ping(monitor.heartbeatToken));
    const recent = await request(app)
      .get(monitorsUrl(`/${monitor.id}/checks?limit=60`))
      .set(viewer.auth);
    expect(recent.body.data.points.map((point) => point.totalMs)).toEqual([check.totalMs, null]);
  });

  it('unknown tokens get 404; paused monitors ignore pings', async () => {
    expect((await request(app).get(ping('x'.repeat(43)))).status).toBe(404);
    expect((await request(app).get(ping('short'))).status).toBe(404);

    const monitor = await createHeartbeat();
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    const res = await request(app).get(ping(monitor.heartbeatToken, '/fail'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ignored: 'paused' });
    expect(await CheckResult.countDocuments()).toBe(0);
    expect((await Monitor.findById(monitor.id).lean()).status).toBe('paused');
  });

  it('rate-limits each token separately (60 per minute)', async () => {
    const noisy = 'n'.repeat(43);
    for (let i = 0; i < 60; i += 1) {
      expect((await request(app).get(ping(noisy))).status).toBe(404);
    }
    const limited = await request(app).get(ping(noisy, '/fail'));
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await request(app).get(ping('q'.repeat(43)))).status).toBe(404);
  });
});

describe('managing heartbeat monitors', () => {
  it('regenerating the token invalidates the old URL (members only)', async () => {
    const monitor = await createHeartbeat();
    const denied = await request(app)
      .post(monitorsUrl(`/${monitor.id}/heartbeat-token`))
      .set(viewer.auth);
    expect(denied.status).toBe(403);

    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/heartbeat-token`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    const fresh = res.body.data.heartbeatToken;
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fresh).not.toBe(monitor.heartbeatToken);
    expect((await request(app).get(ping(monitor.heartbeatToken))).status).toBe(404);
    expect((await request(app).get(ping(fresh))).status).toBe(200);
  });

  it('regenerating a token on an http monitor is not supported', async () => {
    const res = await request(app)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ name: 'Site', url: 'https://example.com', intervalSec: 60 });
    const regen = await request(app)
      .post(monitorsUrl(`/${res.body.data.id}/heartbeat-token`))
      .set(owner.auth);
    expect(regen.status).toBe(400);
    expect(regen.body.error.code).toBe('NOT_SUPPORTED');
  });

  it('"Test now" is not supported for heartbeats (saved or unsaved)', async () => {
    const monitor = await createHeartbeat();
    const saved = await request(app)
      .post(monitorsUrl(`/${monitor.id}/test`))
      .set(owner.auth);
    expect(saved.status).toBe(400);
    expect(saved.body.error.code).toBe('NOT_SUPPORTED');
    const unsaved = await request(app)
      .post(monitorsUrl('/test'))
      .set(owner.auth)
      .send({ type: 'heartbeat', name: 'Job', expectedEverySec: 3600 });
    expect(unsaved.status).toBe(400);
    expect(unsaved.body.error.code).toBe('NOT_SUPPORTED');
  });

  it('PATCH edits the timing and moves the due time; the type cannot change', async () => {
    const monitor = await createHeartbeat();
    const res = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ expectedEverySec: 7200, graceSec: 300 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ expectedEverySec: 7200, graceSec: 300 });
    const dueIn = new Date(res.body.data.nextDueAt) - Date.now();
    expect(dueIn).toBeGreaterThan(7400 * 1000);
    expect(dueIn).toBeLessThanOrEqual(7500 * 1000);
    expect(res.body.data.heartbeatToken).toBe(monitor.heartbeatToken);

    const typeChange = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ type: 'http', url: 'https://example.com' });
    expect(typeChange.status).toBe(400);
    const invalid = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ graceSec: -5 });
    expect(invalid.status).toBe(400);
    expect(scheduler.calls).toEqual([]);
  });

  it('pause and resume never schedule a job; resume restarts the due time', async () => {
    const monitor = await createHeartbeat();
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/resume`))
      .set(owner.auth);
    expect(res.body.data).toMatchObject({ status: 'pending', isPaused: false });
    const dueIn = new Date(res.body.data.nextDueAt) - Date.now();
    expect(dueIn).toBeGreaterThan(3600 * 1000);
    expect(scheduler.calls.filter(([op]) => op === 'schedule')).toEqual([]);
  });
});

describe('heartbeat results feed the existing analytics', () => {
  it('rollups, /daily and the public status page count pings like checks', async () => {
    const monitor = await createHeartbeat();
    await request(app).get(ping(monitor.heartbeatToken));
    await request(app).get(ping(monitor.heartbeatToken, '/fail'));
    await request(app).get(ping(monitor.heartbeatToken));
    await request(app).get(ping(monitor.heartbeatToken));

    await rollupDay(new Date());
    const rollup = await DailyRollup.findOne({ monitorId: monitor.id }).lean();
    expect(rollup).toMatchObject({ totalChecks: 4, upChecks: 3 });

    const daily = await request(app)
      .get(monitorsUrl(`/${monitor.id}/daily?days=7`))
      .set(viewer.auth);
    expect(daily.status).toBe(200);
    expect(daily.body.data.at(-1)).toMatchObject({ totalChecks: 4, upChecks: 3 });

    const page = await request(app)
      .post(`/api/v1/workspaces/${wid}/status-pages`)
      .set(owner.auth)
      .send({ title: 'Jobs', slug: 'jobs', monitorIds: [monitor.id] });
    expect(page.status).toBe(201);
    const status = await request(app).get('/api/v1/public/status/jobs');
    expect(status.status).toBe(200);
    expect(status.body.data.monitors[0]).toMatchObject({ name: 'Nightly backup', status: 'up' });
    expect(JSON.stringify(status.body)).not.toContain(monitor.heartbeatToken);
  });
});
