import http from 'node:http';
import { monthKey } from '@pulseboard/shared/cost';
import { mongoose } from '@pulseboard/shared/db';
import { Monitor, MonitorUsage } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrations, runMigrations } from '../scripts/migrations/index.js';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp();
const silent = { warn() {} };
let server, targetUrl, owner, viewer, wid;

beforeAll(async () => {
  await startMemoryDb();
  server = http.createServer((_req, res) => res.end('healthy'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${server.address().port}/`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await stopMemoryDb();
});

beforeEach(async () => {
  await clearMemoryDb();
  owner = await registerUser(app, { name: 'Owner' });
  viewer = await registerUser(app, { name: 'Viewer' });
  wid = owner.workspaceId;
  await request(app)
    .post(`/api/v1/workspaces/${wid}/members`)
    .set(owner.auth)
    .send({ email: viewer.user.email, role: 'viewer' });
});

const monitorsUrl = (path = '') => `/api/v1/workspaces/${wid}/monitors${path}`;

async function createMonitor(body = {}) {
  const res = await request(app)
    .post(monitorsUrl())
    .set(owner.auth)
    .send({ name: 'Local', url: targetUrl, intervalSec: 60, ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('GET /monitors/:mid/usage', () => {
  it('reports requests sent this month next to the estimate and costs', async () => {
    const monitor = await createMonitor({ costPer1kRequests: 0.5, currency: 'INR' });
    await MonitorUsage.create({
      monitorId: monitor.id,
      workspaceId: wid,
      month: monthKey(new Date()),
      requests: 1234,
    });

    const res = await request(app)
      .get(monitorsUrl(`/${monitor.id}/usage`))
      .set(viewer.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      month: monthKey(new Date()),
      requests: 1234,
      estimatedMonthly: 43_200,
      costPer1kRequests: 0.5,
      currency: 'INR',
      actualCost: 0.62,
      estimatedMonthlyCost: 21.6,
      method: 'HEAD',
      headUnsupported: false,
    });
    // Created just now, so "expected so far" starts at creation, not the 1st.
    expect(res.body.data.estimatedSoFar).toBeLessThanOrEqual(1);
  });

  it('returns zero requests and null costs without usage or a price', async () => {
    const monitor = await createMonitor();
    const res = await request(app)
      .get(monitorsUrl(`/${monitor.id}/usage`))
      .set(owner.auth);
    expect(res.body.data).toMatchObject({
      requests: 0,
      costPer1kRequests: null,
      actualCost: null,
      estimatedMonthlyCost: null,
    });
  });

  it("404s for another workspace's monitor and requires login", async () => {
    const monitor = await createMonitor();
    const outsider = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/workspaces/${outsider.workspaceId}/monitors/${monitor.id}/usage`)
      .set(outsider.auth);
    expect(res.status).toBe(404);
    expect((await request(app).get(monitorsUrl(`/${monitor.id}/usage`))).status).toBe(401);
  });
});

describe('Test now and usage', () => {
  it('a test of a saved monitor is a real request, so it is counted', async () => {
    const monitor = await createMonitor();
    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/test`))
      .set(owner.auth);
    expect(res.body.data).toMatchObject({ ok: true, requestsSent: 1 });

    const usage = await request(app)
      .get(monitorsUrl(`/${monitor.id}/usage`))
      .set(owner.auth);
    expect(usage.body.data.requests).toBe(1);
  });

  it('a test of an unsaved config belongs to no monitor and is not counted', async () => {
    await request(app)
      .post(monitorsUrl('/test'))
      .set(owner.auth)
      .send({ name: 'Draft', url: targetUrl, intervalSec: 60 });
    expect(await MonitorUsage.countDocuments()).toBe(0);
  });
});

describe('migration 001-monitor-types-and-cost', () => {
  // A monitor exactly as phases 1-8 stored it: no type/cost/HEAD fields.
  const oldShape = () => ({
    workspaceId: new mongoose.Types.ObjectId(),
    name: 'Legacy',
    url: 'https://legacy.example',
    method: 'GET',
    intervalSec: 30,
    timeoutMs: 10000,
    expectedStatus: { min: 200, max: 399 },
    keyword: null,
    isPaused: false,
    status: 'down',
    consecutiveFailures: 4,
    consecutiveSuccesses: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  it('adds the new fields with defaults and leaves everything else untouched', async () => {
    const monitors = mongoose.connection.db.collection('monitors');
    const { insertedId } = await monitors.insertOne(oldShape());

    // Later migrations run too (each covered by its own tests).
    expect(await runMigrations(mongoose.connection.db, { logger: silent })).toEqual([
      '001-monitor-types-and-cost',
      '002-adaptive-and-budget',
      '003-user-identities',
      '004-mark-legacy-sample-data',
      '005-rollup-covered-seconds',
    ]);

    const migrated = await monitors.findOne({ _id: insertedId });
    expect(migrated).toMatchObject({
      ...oldShape(),
      workspaceId: migrated.workspaceId,
      type: 'http',
      headUnsupported: false,
      costPer1kRequests: null,
      currency: 'INR',
    });
    expect(migrated.method).toBe('GET'); // existing monitors keep their method
  });

  it('is idempotent: running again (recorded or not) changes nothing', async () => {
    const monitors = mongoose.connection.db.collection('monitors');
    await monitors.insertOne(oldShape());
    await runMigrations(mongoose.connection.db, { logger: silent });
    const before = await monitors.find().toArray();

    // Recorded: skipped.
    expect(await runMigrations(mongoose.connection.db, { logger: silent })).toEqual([]);
    // Not recorded (e.g. crashed before recording): runs again, modifies nothing.
    expect(await migrations[0].up(mongoose.connection.db)).toEqual({ modified: 0 });

    expect(await monitors.find().toArray()).toEqual(before);
  });

  it('does not overwrite values that monitors already have', async () => {
    const monitors = mongoose.connection.db.collection('monitors');
    const { insertedId } = await monitors.insertOne({
      ...oldShape(),
      currency: 'USD',
      costPer1kRequests: 2,
      headUnsupported: true,
    });
    await runMigrations(mongoose.connection.db, { logger: silent });
    expect(await monitors.findOne({ _id: insertedId })).toMatchObject({
      type: 'http',
      currency: 'USD',
      costPer1kRequests: 2,
      headUnsupported: true,
    });
  });

  it('a migrated monitor still loads and behaves like before through the API', async () => {
    const legacy = { ...oldShape(), workspaceId: new mongoose.Types.ObjectId(wid) };
    const { insertedId } = await mongoose.connection.db.collection('monitors').insertOne(legacy);
    await runMigrations(mongoose.connection.db, { logger: silent });

    const res = await request(app)
      .get(monitorsUrl(`/${insertedId}`))
      .set(owner.auth);
    expect(res.body.data).toMatchObject({
      method: 'GET',
      intervalSec: 30,
      status: 'down',
      consecutiveFailures: 4,
      type: 'http',
    });
    expect(await Monitor.countDocuments()).toBe(1);
  });
});
