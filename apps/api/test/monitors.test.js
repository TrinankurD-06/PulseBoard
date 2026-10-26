import { CheckResult, Incident, Monitor, StatusPage } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

/** Records scheduler calls so tests can assert jobs are created/cancelled. */
function fakeScheduler() {
  const calls = [];
  return {
    calls,
    async scheduleMonitor(monitor) {
      calls.push(['schedule', String(monitor._id), monitor.intervalSec]);
    },
    async cancelMonitor(monitorId) {
      calls.push(['cancel', String(monitorId)]);
    },
  };
}

const scheduler = fakeScheduler();
// Production-like: private targets blocked, 30s minimum interval.
const app = buildTestApp({ scheduler, env: { ALLOW_PRIVATE_TARGETS: false, DEMO_MODE: false } });

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let owner, viewer, wid;
const validMonitor = { name: 'Cloudflare DNS', url: 'https://1.1.1.1/', intervalSec: 60 };
const monitorsUrl = (path = '') => `/api/v1/workspaces/${wid}/monitors${path}`;

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

async function createMonitor(body = validMonitor) {
  const res = await request(app).post(monitorsUrl()).set(owner.auth).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('create', () => {
  it('creates a pending monitor with defaults and schedules its job', async () => {
    const monitor = await createMonitor();
    expect(monitor).toMatchObject({
      name: 'Cloudflare DNS',
      method: 'HEAD', // U1: new monitors default to the cheapest request
      type: 'http',
      currency: 'INR',
      costPer1kRequests: null,
      headUnsupported: false,
      timeoutMs: 10000,
      expectedStatus: { min: 200, max: 399 },
      status: 'pending',
      isPaused: false,
      workspaceId: wid,
    });
    expect(scheduler.calls).toEqual([['schedule', monitor.id, 60]]);
  });

  it('validates input', async () => {
    const res = await request(app)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ name: '', url: 'not a url', intervalSec: 10, method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual([
      'intervalSec',
      'method',
      'name',
      'url',
    ]);
    expect(scheduler.calls).toEqual([]);
  });

  it('blocks private, loopback and metadata targets (SSRF)', async () => {
    for (const url of ['http://127.0.0.1:4001', 'http://169.254.169.254/', 'http://10.0.0.8']) {
      const res = await request(app)
        .post(monitorsUrl())
        .set(owner.auth)
        .send({ ...validMonitor, url });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSAFE_TARGET');
      expect(res.body.error.details[0].path).toBe('url');
    }
    expect(await Monitor.countDocuments()).toBe(0);
  });

  it('allows private targets when ALLOW_PRIVATE_TARGETS is on (local demo)', async () => {
    const demoApp = buildTestApp({ scheduler, env: { ALLOW_PRIVATE_TARGETS: true } });
    const res = await request(demoApp)
      .post(monitorsUrl())
      .set(owner.auth)
      .send({ ...validMonitor, url: 'http://localhost:4001' });
    expect(res.status).toBe(201);
  });

  it('does not let a viewer create monitors', async () => {
    const res = await request(app).post(monitorsUrl()).set(viewer.auth).send(validMonitor);
    expect(res.status).toBe(403);
    expect(await Monitor.countDocuments()).toBe(0);
  });
});

describe('read', () => {
  it('lists monitors newest first, paginated, filterable by status', async () => {
    await createMonitor({ ...validMonitor, name: 'First' });
    const second = await createMonitor({ ...validMonitor, name: 'Second' });
    await request(app)
      .post(monitorsUrl(`/${second.id}/pause`))
      .set(owner.auth);

    const all = await request(app).get(monitorsUrl()).set(viewer.auth);
    expect(all.status).toBe(200);
    expect(all.body.data.map((m) => m.name)).toEqual(['Second', 'First']);
    expect(all.body.pagination.total).toBe(2);

    const paused = await request(app).get(monitorsUrl('?status=paused')).set(viewer.auth);
    expect(paused.body.data.map((m) => m.name)).toEqual(['Second']);
  });

  it('hides header values from viewers but not from members', async () => {
    const monitor = await createMonitor({
      ...validMonitor,
      headers: { Authorization: 'Bearer secret' },
    });
    const asViewer = await request(app)
      .get(monitorsUrl(`/${monitor.id}`))
      .set(viewer.auth);
    expect(asViewer.body.data.headers).toEqual({ Authorization: '••••••' });
    const asOwner = await request(app)
      .get(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth);
    expect(asOwner.body.data.headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it("returns 404 for another workspace's monitor", async () => {
    const monitor = await createMonitor();
    const outsider = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/workspaces/${outsider.workspaceId}/monitors/${monitor.id}`)
      .set(outsider.auth);
    expect(res.status).toBe(404);
  });
});

describe('update', () => {
  it('applies a partial update without resetting other fields, and reschedules', async () => {
    const monitor = await createMonitor({ ...validMonitor, method: 'POST', keyword: 'ok' });
    scheduler.calls.length = 0;

    const res = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ intervalSec: 120 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ intervalSec: 120, method: 'POST', keyword: 'ok' });
    expect(scheduler.calls).toEqual([['schedule', monitor.id, 120]]);
  });

  it('re-validates cross-field rules against the stored monitor', async () => {
    const monitor = await createMonitor({ ...validMonitor, intervalSec: 60, timeoutMs: 20000 });
    const res = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ intervalSec: 30, timeoutMs: 30001 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('timeoutMs');
  });

  it('runs the SSRF check when the URL changes', async () => {
    const monitor = await createMonitor();
    const res = await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ url: 'http://192.168.1.1/' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSAFE_TARGET');
  });

  it('does not reschedule a paused monitor', async () => {
    const monitor = await createMonitor();
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    scheduler.calls.length = 0;
    await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ name: 'x' });
    expect(scheduler.calls).toEqual([]);
  });
});

describe('pause / resume', () => {
  it('pausing cancels the job; resuming resets counters and reschedules', async () => {
    const monitor = await createMonitor();
    await Monitor.updateOne(
      { _id: monitor.id },
      { status: 'down', consecutiveFailures: 5, consecutiveSuccesses: 0 },
    );
    scheduler.calls.length = 0;

    const paused = await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    expect(paused.body.data).toMatchObject({ isPaused: true, status: 'paused' });
    expect(scheduler.calls).toEqual([['cancel', monitor.id]]);

    const resumed = await request(app)
      .post(monitorsUrl(`/${monitor.id}/resume`))
      .set(owner.auth);
    expect(resumed.body.data).toMatchObject({
      isPaused: false,
      status: 'pending',
      consecutiveFailures: 0,
    });
    expect(scheduler.calls.at(-1)).toEqual(['schedule', monitor.id, 60]);
  });

  it('does not let a viewer pause', async () => {
    const monitor = await createMonitor();
    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(viewer.auth);
    expect(res.status).toBe(403);
  });
});

describe('delete', () => {
  it('cancels the job and removes the monitor with its data', async () => {
    const monitor = await createMonitor();
    await CheckResult.create({
      timestamp: new Date(),
      meta: { monitorId: monitor.id, workspaceId: wid },
      ok: true,
    });
    await Incident.create({ monitorId: monitor.id, workspaceId: wid, startedAt: new Date() });
    await StatusPage.create({ workspaceId: wid, slug: 's', title: 'S', monitorIds: [monitor.id] });
    scheduler.calls.length = 0;

    const res = await request(app)
      .delete(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth);

    expect(res.status).toBe(204);
    expect(scheduler.calls).toEqual([['cancel', monitor.id]]);
    expect(await Monitor.countDocuments()).toBe(0);
    expect(await CheckResult.countDocuments()).toBe(0);
    expect(await Incident.countDocuments()).toBe(0);
    expect((await StatusPage.findOne()).monitorIds).toHaveLength(0);
  });

  it('deleting a workspace cancels all of its monitor jobs', async () => {
    const a = await createMonitor();
    const b = await createMonitor({ ...validMonitor, name: 'B' });
    scheduler.calls.length = 0;
    await request(app).delete(`/api/v1/workspaces/${wid}`).set(owner.auth);
    expect(scheduler.calls.map(([, id]) => id).sort()).toEqual([a.id, b.id].sort());
    expect(await Monitor.countDocuments()).toBe(0);
  });
});

describe('GET /meta', () => {
  it('exposes the minimum interval for the current mode', async () => {
    const res = await request(app).get('/api/v1/meta');
    expect(res.body.data).toMatchObject({ demoMode: false, minIntervalSec: 30 });
  });
});
