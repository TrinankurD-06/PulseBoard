import { monthKey } from '@pulseboard/shared/cost';
import { Monitor, MonitorUsage } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp();
let owner, viewer, outsider, wid;

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

beforeEach(async () => {
  await clearMemoryDb();
  owner = await registerUser(app, { name: 'Owner' });
  viewer = await registerUser(app, { name: 'Viewer' });
  outsider = await registerUser(app, { name: 'Outsider' });
  wid = owner.workspaceId;
  await request(app)
    .post(`/api/v1/workspaces/${wid}/members`)
    .set(owner.auth)
    .send({ email: viewer.user.email, role: 'viewer' });
});

const usageUrl = (query = '') => `/api/v1/workspaces/${wid}/usage${query}`;
const THIS_MONTH = monthKey(new Date());

async function createMonitor(body) {
  const res = await request(app)
    .post(`/api/v1/workspaces/${wid}/monitors`)
    .set(owner.auth)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

const addUsage = (monitorId, fields, month = THIS_MONTH) =>
  MonitorUsage.create({ monitorId, workspaceId: wid, month, ...fields });

/** One monitor of each type, two currencies, one monitor without a price. */
async function seedWorkspace() {
  const api = await createMonitor({
    name: 'API',
    url: 'https://example.com/',
    intervalSec: 60,
    adaptive: false,
    costPer1kRequests: 0.5,
    currency: 'INR',
  });
  const site = await createMonitor({
    name: 'Site',
    url: 'https://example.org/',
    intervalSec: 120,
    adaptive: false,
    costPer1kRequests: 2,
    currency: 'USD',
  });
  const backup = await createMonitor({
    type: 'heartbeat',
    name: 'Backup',
    expectedEverySec: 3600,
  });
  const agent = await createMonitor({ type: 'agent', name: 'Checkout', reportEverySec: 60 });
  await addUsage(api.id, { requests: 1234 });
  await addUsage(site.id, { requests: 100 });
  await addUsage(backup.id, { pings: 24 });
  await addUsage(agent.id, { reports: 1440 });
  return { api, site, backup, agent };
}

describe('GET /workspaces/:wid/usage', () => {
  it('returns one row per monitor and per-currency totals for this month', async () => {
    const { api, backup, agent } = await seedWorkspace();

    const res = await request(app).get(usageUrl()).set(viewer.auth);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.month).toBe(THIS_MONTH);
    expect(data.totals).toEqual({
      monitors: 4,
      byType: { http: 2, heartbeat: 1, agent: 1 },
      requests: 1334,
      // 43,200 (every 60 s) + 21,600 (every 120 s); push monitors send nothing.
      estimatedMonthlyRequests: 64_800,
      // 0 + 21,600 + 43,200 + 43,200 compared with polling every minute.
      requestsSaved: 108_000,
      pings: 24,
      reports: 1440,
      costByCurrency: [
        { currency: 'INR', actual: 0.62, estimatedMonthly: 21.6 },
        { currency: 'USD', actual: 0.2, estimatedMonthly: 43.2 },
      ],
    });

    const rows = Object.fromEntries(data.monitors.map((row) => [row.id, row]));
    expect(rows[api.id]).toMatchObject({
      name: 'API',
      type: 'http',
      status: 'pending',
      intervalLabelSec: 60,
      adaptive: false,
      baseIntervalSec: 60,
      currentIntervalSec: 60,
      slowedByBudget: false,
      requests: 1234,
      estimatedMonthlyRequests: 43_200,
      requestsSaved: 0,
      costPer1kRequests: 0.5,
      currency: 'INR',
      actualCost: 0.62,
      estimatedMonthlyCost: 21.6,
      budget: { monthlyRequestBudget: null, usedRatio: null, state: 'none' },
    });
    expect(rows[backup.id]).toMatchObject({
      type: 'heartbeat',
      intervalLabelSec: 3600,
      adaptive: false,
      currentIntervalSec: null,
      requests: 0,
      pings: 24,
      requestsSaved: 43_200,
      actualCost: null,
    });
    expect(rows[agent.id]).toMatchObject({
      type: 'agent',
      intervalLabelSec: 60,
      reports: 1440,
      requestsSaved: 43_200,
      estimatedMonthlyRequests: 0,
    });
    // Nothing secret or configuration-only leaks into the cost page.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('example.com');
    expect(body).not.toMatch(/heartbeatToken|agentKeyHash/);
  });

  it('shows budget usage and the adaptive / slowed state of http monitors', async () => {
    const monitor = await createMonitor({
      name: 'Budgeted',
      url: 'https://example.com/',
      intervalSec: 60,
      adaptive: true,
      monthlyRequestBudget: 1000,
    });
    await Monitor.updateOne(
      { _id: monitor.id },
      { currentIntervalSec: 900, budgetExceededMonth: THIS_MONTH, budgetAction: 'slow' },
    );
    await addUsage(monitor.id, { requests: 1000 });

    const res = await request(app).get(usageUrl()).set(owner.auth);

    expect(res.body.data.monitors[0]).toMatchObject({
      adaptive: true,
      baseIntervalSec: 60,
      currentIntervalSec: 900,
      intervalLabelSec: 900,
      slowedByBudget: true,
      budget: { monthlyRequestBudget: 1000, budgetAction: 'slow', usedRatio: 1, state: 'exceeded' },
    });
  });

  it('a paused monitor is estimated to send (and save) nothing', async () => {
    const monitor = await createMonitor({
      name: 'Paused',
      url: 'https://example.com/',
      intervalSec: 60,
      costPer1kRequests: 1,
    });
    await Monitor.updateOne({ _id: monitor.id }, { isPaused: true, pausedReason: 'manual' });

    const res = await request(app).get(usageUrl()).set(owner.auth);

    expect(res.body.data.monitors[0]).toMatchObject({
      paused: true,
      pausedReason: 'manual',
      estimatedMonthlyRequests: 0,
      requestsSaved: 0,
      estimatedMonthlyCost: 0,
    });
  });

  it('reads another month when asked and validates the month', async () => {
    const { api } = await seedWorkspace();
    await addUsage(api.id, { requests: 5000 }, '2026-01');

    const past = await request(app).get(usageUrl('?month=2026-01')).set(owner.auth);
    expect(past.status).toBe(200);
    expect(past.body.data.month).toBe('2026-01');
    expect(past.body.data.totals.requests).toBe(5000);
    expect(past.body.data.totals.pings).toBe(0);
    // Every monitor still has a row, with zero usage when it has no document that month.
    expect(past.body.data.monitors).toHaveLength(4);

    for (const month of ['2026-13', '2026-1', 'october', '2026-00']) {
      const bad = await request(app)
        .get(usageUrl(`?month=${month}`))
        .set(owner.auth);
      expect(bad.status).toBe(400);
    }
  });

  it('is empty for a workspace without monitors', async () => {
    const res = await request(app).get(usageUrl()).set(owner.auth);
    expect(res.body.data).toEqual({
      month: THIS_MONTH,
      totals: {
        monitors: 0,
        byType: { http: 0, heartbeat: 0, agent: 0 },
        requests: 0,
        estimatedMonthlyRequests: 0,
        requestsSaved: 0,
        pings: 0,
        reports: 0,
        costByCurrency: [],
      },
      monitors: [],
    });
  });

  it('only shows this workspace and requires membership', async () => {
    await seedWorkspace();
    await createMonitor({ name: 'Mine', url: 'https://example.com/', intervalSec: 60 });
    const foreign = await request(app)
      .post(`/api/v1/workspaces/${outsider.workspaceId}/monitors`)
      .set(outsider.auth)
      .send({ name: 'Theirs', url: 'https://example.net/', intervalSec: 60 });
    expect(foreign.status).toBe(201);

    const res = await request(app).get(usageUrl()).set(owner.auth);
    expect(res.body.data.monitors.map((row) => row.name)).not.toContain('Theirs');

    expect((await request(app).get(usageUrl()).set(outsider.auth)).status).toBe(404);
    expect((await request(app).get(usageUrl())).status).toBe(401);
  });

  it('deleting a monitor removes its usage too', async () => {
    const { api } = await seedWorkspace();
    await request(app).delete(`/api/v1/workspaces/${wid}/monitors/${api.id}`).set(owner.auth);
    expect(await MonitorUsage.countDocuments({ monitorId: api.id })).toBe(0);

    const res = await request(app).get(usageUrl()).set(owner.auth);
    expect(res.body.data.totals.requests).toBe(100);
  });
});
