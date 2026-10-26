import { monthKey } from '@pulseboard/shared/cost';
import { mongoose } from '@pulseboard/shared/db';
import { Monitor, MonitorUsage } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrations } from '../scripts/migrations/index.js';
import { buildTestApp, registerUser } from './helpers.js';

/** Records scheduler calls so tests can assert what was (re)scheduled. */
function recordingScheduler() {
  const calls = [];
  return {
    calls,
    async scheduleMonitor(monitor) {
      calls.push([
        'schedule',
        String(monitor._id),
        monitor.currentIntervalSec ?? monitor.intervalSec,
      ]);
    },
    async cancelMonitor(id) {
      calls.push(['cancel', String(id)]);
    },
  };
}

const scheduler = recordingScheduler();
// Production-like interval rules (30 s minimum).
const app = buildTestApp({ scheduler, env: { DEMO_MODE: false } });
let owner, viewer, wid;

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

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

const url = (path = '') => `/api/v1/workspaces/${wid}/monitors${path}`;

async function createMonitor(body = {}) {
  const res = await request(app)
    .post(url())
    .set(owner.auth)
    .send({ name: 'API', url: 'https://1.1.1.1/', intervalSec: 60, ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** Puts a monitor in the state the worker leaves it in after the budget ran out. */
async function exhaustBudget(monitor, { action, requests }) {
  await MonitorUsage.create({
    monitorId: monitor.id,
    workspaceId: wid,
    month: monthKey(),
    requests,
    warnedAt: new Date(),
    exceededAt: new Date(),
  });
  await Monitor.updateOne(
    { _id: monitor.id },
    action === 'pause'
      ? {
          isPaused: true,
          status: 'paused',
          pausedReason: 'budget_exceeded',
          budgetExceededMonth: monthKey(),
        }
      : { budgetExceededMonth: monthKey(), currentIntervalSec: 900 },
  );
}

describe('new monitors', () => {
  it('are adaptive with bounds, start at the base interval and are scheduled with it', async () => {
    const monitor = await createMonitor();
    expect(monitor).toMatchObject({
      adaptive: true,
      minIntervalSec: 30,
      maxIntervalSec: 600,
      monthlyRequestBudget: null,
      budgetAction: 'slow',
      pausedReason: null,
    });
    expect(scheduler.calls).toEqual([['schedule', monitor.id, 60]]);
  });
});

describe('interval changes', () => {
  it('a new base interval resets the adapted interval; other edits keep it', async () => {
    const monitor = await createMonitor();
    await Monitor.updateOne({ _id: monitor.id }, { currentIntervalSec: 240 });

    const renamed = await request(app)
      .patch(url(`/${monitor.id}`))
      .set(owner.auth)
      .send({ name: 'x' });
    expect(renamed.body.data.currentIntervalSec).toBe(240);

    scheduler.calls.length = 0;
    const res = await request(app)
      .patch(url(`/${monitor.id}`))
      .set(owner.auth)
      .send({ intervalSec: 120 });
    expect(res.body.data.currentIntervalSec).toBe(120);
    expect(scheduler.calls).toEqual([['schedule', monitor.id, 120]]);
  });
});

describe('budget changes', () => {
  it('raising the budget lifts a budget pause right away and resets the markers', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 100, budgetAction: 'pause' });
    await exhaustBudget(monitor, { action: 'pause', requests: 100 });
    scheduler.calls.length = 0;

    const res = await request(app)
      .patch(url(`/${monitor.id}`))
      .set(owner.auth)
      .send({ monthlyRequestBudget: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      isPaused: false,
      status: 'pending',
      pausedReason: null,
      budgetExceededMonth: null,
      monthlyRequestBudget: 1000,
    });
    expect(scheduler.calls.some(([op]) => op === 'schedule')).toBe(true);
    const usage = await MonitorUsage.findOne().lean();
    expect(usage).toMatchObject({ exceededAt: null, warnedAt: null });
  });

  it('raising it to still above 80% keeps the warning marker', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 100 });
    await exhaustBudget(monitor, { action: 'slow', requests: 100 });
    await request(app)
      .patch(url(`/${monitor.id}`))
      .set(owner.auth)
      .send({ monthlyRequestBudget: 110 });

    const after = await Monitor.findById(monitor.id).lean();
    expect(after).toMatchObject({ budgetExceededMonth: null, currentIntervalSec: 60 });
    const usage = await MonitorUsage.findOne().lean();
    expect(usage.exceededAt).toBeNull();
    expect(usage.warnedAt).toBeInstanceOf(Date);
  });

  it('a budget still below usage keeps the restriction', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 100 });
    await exhaustBudget(monitor, { action: 'slow', requests: 150 });
    await request(app)
      .patch(url(`/${monitor.id}`))
      .set(owner.auth)
      .send({ monthlyRequestBudget: 120 });
    expect((await Monitor.findById(monitor.id).lean()).budgetExceededMonth).toBe(monthKey());
  });

  it('viewers cannot change the budget', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 100 });
    const res = await request(app)
      .patch(url(`/${monitor.id}`))
      .set(viewer.auth)
      .send({ monthlyRequestBudget: 1e6 });
    expect(res.status).toBe(403);
  });
});

describe('pause / resume reasons', () => {
  it('user pause records the reason; resume clears it', async () => {
    const monitor = await createMonitor();
    const paused = await request(app)
      .post(url(`/${monitor.id}/pause`))
      .set(owner.auth);
    expect(paused.body.data.pausedReason).toBe('user');
    const resumed = await request(app)
      .post(url(`/${monitor.id}/resume`))
      .set(owner.auth);
    expect(resumed.body.data).toMatchObject({ isPaused: false, pausedReason: null });
  });

  it('cannot resume a budget-paused monitor while still over budget', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 100, budgetAction: 'pause' });
    await exhaustBudget(monitor, { action: 'pause', requests: 100 });

    const res = await request(app)
      .post(url(`/${monitor.id}/resume`))
      .set(owner.auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'BUDGET_EXCEEDED',
      message: 'Raise the monthly budget to resume this monitor',
    });
  });
});

describe('usage endpoint (U2 fields)', () => {
  it('reports budget usage and the interval in use', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 1000 });
    await MonitorUsage.create({
      monitorId: monitor.id,
      workspaceId: wid,
      month: monthKey(),
      requests: 820,
    });
    await Monitor.updateOne({ _id: monitor.id }, { currentIntervalSec: 240 });

    const res = await request(app)
      .get(url(`/${monitor.id}/usage`))
      .set(viewer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.budget).toEqual({
      monthlyRequestBudget: 1000,
      budgetAction: 'slow',
      usedRatio: 0.82,
      state: 'warning',
      exceededThisMonth: false,
    });
    expect(res.body.data.interval).toEqual({
      adaptive: true,
      intervalSec: 60,
      currentIntervalSec: 240,
      minIntervalSec: 30,
      maxIntervalSec: 600,
      slowedByBudget: false,
    });
  });

  it('shows no budget and the base interval for a plain monitor', async () => {
    const monitor = await createMonitor({ adaptive: false });
    const res = await request(app)
      .get(url(`/${monitor.id}/usage`))
      .set(owner.auth);
    expect(res.body.data.budget).toMatchObject({
      monthlyRequestBudget: null,
      usedRatio: null,
      state: 'none',
    });
    expect(res.body.data.interval).toMatchObject({ adaptive: false, currentIntervalSec: 60 });
  });
});

describe('migration 002-adaptive-and-budget', () => {
  const migration = migrations.find((m) => m.name === '002-adaptive-and-budget');
  const oldShape = (overrides) => ({
    workspaceId: new mongoose.Types.ObjectId(),
    name: 'Legacy',
    url: 'https://legacy.example',
    method: 'GET',
    type: 'http',
    timeoutMs: 10000,
    status: 'up',
    consecutiveFailures: 0,
    consecutiveSuccesses: 7,
    ...overrides,
  });

  it('keeps existing behaviour: not adaptive, same interval, no budget, bounds that fit', async () => {
    const monitors = mongoose.connection.db.collection('monitors');
    const { insertedIds } = await monitors.insertMany([
      oldShape({ intervalSec: 3600, isPaused: true, status: 'paused' }),
      oldShape({ intervalSec: 10, isPaused: false }),
    ]);

    await migration.up(mongoose.connection.db);
    const [slow, fast] = await Promise.all([
      monitors.findOne({ _id: insertedIds[0] }),
      monitors.findOne({ _id: insertedIds[1] }),
    ]);

    expect(slow).toMatchObject({
      adaptive: false,
      currentIntervalSec: 3600,
      minIntervalSec: 30,
      maxIntervalSec: 3600,
      monthlyRequestBudget: null,
      budgetAction: 'slow',
      budgetExceededMonth: null,
      pausedReason: 'user',
      consecutiveSuccesses: 7,
      method: 'GET',
    });
    expect(fast).toMatchObject({
      currentIntervalSec: 10,
      minIntervalSec: 10,
      maxIntervalSec: 600,
      pausedReason: null,
    });
  });

  it('is idempotent', async () => {
    const monitors = mongoose.connection.db.collection('monitors');
    await monitors.insertOne(oldShape({ intervalSec: 60, isPaused: false }));
    await migration.up(mongoose.connection.db);
    const before = await monitors.find().toArray();
    expect(await migration.up(mongoose.connection.db)).toEqual({ modified: 0 });
    expect(await monitors.find().toArray()).toEqual(before);
  });
});
