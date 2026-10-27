import { CHECK_SOURCES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import {
  AgentReport,
  AlertChannel,
  CheckResult,
  DailyRollup,
  Incident,
  Monitor,
  MonitorUsage,
  StatusPage,
  User,
  Workspace,
} from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearSeedData, countSeedData } from '../scripts/lib/seedClear.js';
import { seedMonitors } from '../scripts/lib/seedData.js';
import {
  name as migrationName,
  up as markLegacy,
} from '../scripts/migrations/004-mark-legacy-sample-data.js';
import { generateAgentKey } from '../src/modules/agent/agentKey.js';
import { generateHeartbeatToken } from '../src/modules/monitors/monitors.service.js';
import { createWorkspaceWithOwner } from '../src/modules/workspaces/workspaces.service.js';

const silent = { warn() {} };
const REAL = ['Google', 'GitHub', 'Example.com'];
const FICTIONAL = ['Demo API', 'Demo Checkout', 'Demo Cron Job', 'Demo Agent'];
const DAY = 24 * 60 * 60 * 1000;

let scheduler, closeAgenda, jobs;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  const created = createAgenda({ mongoUri: replSet.getUri('pulseboard-test'), name: 'seed-test' });
  closeAgenda = created.close;
  await created.agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  scheduler = createAgendaScheduler(created.agenda);
  jobs = mongoose.connection.db.collection(AGENDA_COLLECTION);
});

afterAll(async () => {
  await closeAgenda();
  await stopMemoryDb();
});

beforeEach(clearMemoryDb);

async function workspaceFor(email) {
  const user = await User.create({ name: email, email, passwordHash: 'x' });
  return createWorkspaceWithOwner({ name: `WS ${email}`, ownerId: user._id });
}

const seedInto = (workspace, options = {}) =>
  seedMonitors({
    workspace,
    scheduler,
    secrets: { agentKey: generateAgentKey(), heartbeatToken: generateHeartbeatToken() },
    includeLocalDemo: true,
    demoMode: false,
    demoTargetUrl: 'http://localhost:4011/',
    ...options,
  });

const byName = async (workspace, name) => Monitor.findOne({ workspaceId: workspace._id, name });

/** Counts of every history collection for the given monitor ids. */
async function historyOf(monitorIds) {
  const [checks, rollups, incidents, usage, reports] = await Promise.all([
    CheckResult.countDocuments({ 'meta.monitorId': { $in: monitorIds } }),
    DailyRollup.countDocuments({ monitorId: { $in: monitorIds } }),
    Incident.countDocuments({ monitorId: { $in: monitorIds } }),
    MonitorUsage.countDocuments({ monitorId: { $in: monitorIds } }),
    AgentReport.countDocuments({ 'meta.monitorId': { $in: monitorIds } }),
  ]);
  return { checks, rollups, incidents, usage, reports };
}

describe('the seed', () => {
  it('creates real sites empty and the fictional monitors with flagged history', async () => {
    const workspace = await workspaceFor('a@example.com');
    await seedInto(workspace);

    const monitors = await Monitor.find({ workspaceId: workspace._id }).lean();
    expect(monitors.map((m) => m.name).sort()).toEqual([...REAL, ...FICTIONAL].sort());

    for (const monitor of monitors) {
      const history = await historyOf([monitor._id]);
      if (REAL.includes(monitor.name)) {
        expect(monitor.isSeed).toBe(false);
        expect(monitor.status).toBe('pending');
        expect(history).toEqual({ checks: 0, rollups: 0, incidents: 0, usage: 0, reports: 0 });
      } else {
        expect(monitor.isSeed).toBe(true);
        expect(history.checks).toBeGreaterThan(0);
        expect(history.rollups).toBeGreaterThanOrEqual(30);
        expect(history.incidents).toBeGreaterThan(0);
        expect(history.usage).toBe(1);
        if (monitor.name === 'Demo Agent') expect(history.reports).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the cost fields and budget of the real sites', async () => {
    const workspace = await workspaceFor('a@example.com');
    await seedInto(workspace);
    const example = await byName(workspace, 'Example.com');
    expect(example.monthlyRequestBudget).toBe(15_000);
    expect(example.costPer1kRequests).toBe(0.25);
    expect((await byName(workspace, 'GitHub')).currency).toBe('USD');
  });

  it('flags every document of the fictional monitors and sets coveredSec on rollups', async () => {
    const workspace = await workspaceFor('a@example.com');
    await seedInto(workspace);
    const ids = (await Monitor.find({ isSeed: true }).lean()).map((m) => m._id);

    expect(
      await CheckResult.countDocuments({ 'meta.monitorId': { $in: ids }, isSeed: false }),
    ).toBe(0);
    expect(await Incident.countDocuments({ monitorId: { $in: ids }, isSeed: false })).toBe(0);
    expect(await MonitorUsage.countDocuments({ monitorId: { $in: ids }, isSeed: false })).toBe(0);
    expect(
      await AgentReport.countDocuments({ 'meta.monitorId': { $in: ids }, isSeed: false }),
    ).toBe(0);
    expect(await DailyRollup.countDocuments({ monitorId: { $in: ids }, isSeed: false })).toBe(0);

    const full = await DailyRollup.find({
      monitorId: { $in: ids },
      isFinal: true,
      coveredSec: 86400,
    });
    expect(full.length).toBeGreaterThanOrEqual(29 * 4);
    const api = await byName(workspace, 'Demo API');
    const downtime = await DailyRollup.find({ monitorId: api._id, downtimeSec: { $gt: 0 } });
    expect(downtime.length).toBeGreaterThan(0);
    expect((await CheckResult.findOne({ 'meta.monitorId': api._id })).source).toBe(
      CHECK_SOURCES.HTTP,
    );
  });

  it('skips the fictional monitors when the local demo is off', async () => {
    const workspace = await workspaceFor('a@example.com');
    await seedInto(workspace, { includeLocalDemo: false });
    const names = (await Monitor.find({ workspaceId: workspace._id }).lean()).map((m) => m.name);
    expect(names.sort()).toEqual([...REAL].sort());
    expect(await CheckResult.countDocuments()).toBe(0);
    expect(await Incident.countDocuments()).toBe(0);
  });
});

describe('clearSeedData', () => {
  async function setup() {
    const workspace = await workspaceFor('a@example.com');
    const { monitors } = await seedInto(workspace);
    const statusPage = await StatusPage.create({
      workspaceId: workspace._id,
      slug: 'acme',
      title: 'Acme',
      monitorIds: monitors.map((m) => m._id),
      isPublic: true,
    });
    await AlertChannel.create({
      workspaceId: workspace._id,
      name: 'Inbox',
      type: 'email',
      target: 'a@example.com',
    });

    // Genuine data of a real monitor, created now and never flagged.
    const google = await byName(workspace, 'Google');
    await Incident.create({
      monitorId: google._id,
      workspaceId: workspace._id,
      startedAt: new Date(),
      cause: 'real outage',
      resolvedAt: new Date(),
    });
    await DailyRollup.create({
      monitorId: google._id,
      workspaceId: workspace._id,
      date: new Date(Date.now() - DAY),
      totalChecks: 10,
      upChecks: 10,
    });
    await CheckResult.create({
      timestamp: new Date(),
      meta: { monitorId: google._id, workspaceId: workspace._id },
      ok: true,
    });
    await MonitorUsage.create({
      monitorId: google._id,
      workspaceId: workspace._id,
      month: '2026-10',
      requests: 5,
    });
    return { workspace, statusPage, google };
  }

  it('removes the fictional monitors and everything they own', async () => {
    const { workspace, statusPage } = await setup();
    const seededIds = (await Monitor.find({ isSeed: true }).lean()).map((m) => m._id);
    expect(seededIds).toHaveLength(4);
    expect(await jobs.countDocuments({ 'data.monitorId': { $in: seededIds.map(String) } })).toBe(2);

    const planned = await countSeedData();
    const result = await clearSeedData({ logger: silent });
    expect(result.monitors).toBe(4);
    expect(result).toMatchObject({
      incidents: planned.incidents,
      rollups: planned.rollups,
      checks: planned.checks,
      usage: planned.usage,
      agentReports: planned.agentReports,
      jobs: 2,
      statusPages: 1,
    });

    expect(await Monitor.countDocuments({ isSeed: true })).toBe(0);
    expect(await historyOf(seededIds)).toEqual({
      checks: 0,
      rollups: 0,
      incidents: 0,
      usage: 0,
      reports: 0,
    });
    expect(await jobs.countDocuments({ 'data.monitorId': { $in: seededIds.map(String) } })).toBe(0);
    const page = await StatusPage.findById(statusPage._id).lean();
    expect(page.monitorIds).toHaveLength(3);
    for (const id of seededIds) expect(page.monitorIds.map(String)).not.toContain(String(id));
    expect(workspace).toBeTruthy();
  });

  it('leaves real monitors, their data, users, workspaces and channels untouched', async () => {
    const { workspace, google } = await setup();
    const realIds = (await Monitor.find({ isSeed: false }).lean()).map((m) => m._id);
    const before = await historyOf(realIds);
    expect(before.incidents).toBe(1);

    await clearSeedData({ logger: silent });

    const names = (await Monitor.find({ workspaceId: workspace._id }).lean()).map((m) => m.name);
    expect(names.sort()).toEqual([...REAL].sort());
    expect(await historyOf(realIds)).toEqual(before);
    expect((await Incident.findOne({ monitorId: google._id })).cause).toBe('real outage');
    // The real sites keep their scheduler jobs.
    expect(await jobs.countDocuments({ 'data.monitorId': { $in: realIds.map(String) } })).toBe(3);
    expect(await User.countDocuments()).toBe(1);
    expect(await Workspace.countDocuments()).toBe(1);
    expect(await AlertChannel.countDocuments()).toBe(1);
  });

  it('also removes flagged history that sits on a real monitor', async () => {
    const { workspace, google } = await setup();
    await Incident.create({
      monitorId: google._id,
      workspaceId: workspace._id,
      startedAt: new Date(Date.now() - 10 * DAY),
      cause: 'sample',
      resolvedAt: new Date(),
      isSeed: true,
    });
    await clearSeedData({ logger: silent });
    expect(await Incident.countDocuments({ monitorId: google._id })).toBe(1);
    expect((await Incident.findOne({ monitorId: google._id })).cause).toBe('real outage');
  });

  it('is a no-op the second time', async () => {
    await setup();
    await clearSeedData({ logger: silent });
    const second = await clearSeedData({ logger: silent });
    expect(second).toEqual({
      monitors: 0,
      incidents: 0,
      rollups: 0,
      checks: 0,
      usage: 0,
      agentReports: 0,
      jobs: 0,
      statusPages: 0,
    });
    expect(await Monitor.countDocuments()).toBe(3);
  });
});

describe(`migration ${migrationName}`, () => {
  const db = () => mongoose.connection.db;

  async function legacySetup() {
    const workspace = await workspaceFor('a@example.com');
    const createdAt = new Date('2026-10-20T15:30:00Z');
    const monitor = await Monitor.create({
      workspaceId: workspace._id,
      name: 'Legacy',
      intervalSec: 60,
      url: 'https://example.com/',
      createdAt,
    });
    // Collection.insertOne bypasses Mongoose's timestamps, so createdAt stays as given.
    await db().collection('monitors').updateOne({ _id: monitor._id }, { $set: { createdAt } });
    const base = { monitorId: monitor._id, workspaceId: workspace._id };
    const resolved = { resolvedAt: new Date() };
    const meta = { monitorId: monitor._id, workspaceId: workspace._id };

    const hour = 60 * 60 * 1000;
    await Incident.create([
      { ...base, startedAt: new Date(createdAt.getTime() - 5 * DAY), cause: 'old', ...resolved },
      { ...base, startedAt: new Date(createdAt.getTime() - 1), cause: 'just before', ...resolved },
      { ...base, startedAt: createdAt, cause: 'exactly at', ...resolved },
      { ...base, startedAt: new Date(createdAt.getTime() + hour), cause: 'after', ...resolved },
    ]);
    const day = (iso) => ({ ...base, date: new Date(iso), totalChecks: 5, upChecks: 5 });
    await DailyRollup.create([
      day('2026-10-10T00:00:00Z'),
      day('2026-10-19T00:00:00Z'),
      day('2026-10-20T00:00:00Z'), // the creation day itself
      day('2026-10-21T00:00:00Z'),
    ]);
    await CheckResult.insertMany([
      { timestamp: new Date(createdAt.getTime() - 3 * hour), meta, ok: true },
      { timestamp: new Date(createdAt.getTime() - 1000), meta, ok: true },
      { timestamp: createdAt, meta, ok: true },
      { timestamp: new Date(createdAt.getTime() + hour), meta, ok: true },
    ]);
    return { monitor, createdAt };
  }

  it('marks and deletes only history older than the monitor', async () => {
    const { monitor, createdAt } = await legacySetup();
    const result = await markLegacy(db());
    expect(result).toEqual({ incidentsMarked: 2, rollupsMarked: 2, checksDeleted: 2 });

    const incidents = await Incident.find({ monitorId: monitor._id }).lean();
    expect(Object.fromEntries(incidents.map((i) => [i.cause, i.isSeed]))).toEqual({
      old: true,
      'just before': true,
      'exactly at': false,
      after: false,
    });
    const rollups = await DailyRollup.find({ monitorId: monitor._id }).lean();
    expect(
      rollups
        .filter((r) => r.isSeed)
        .map((r) => r.date.toISOString().slice(0, 10))
        .sort(),
    ).toEqual(['2026-10-10', '2026-10-19']);
    const checks = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(checks).toHaveLength(2);
    for (const check of checks)
      expect(check.timestamp.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });

  it('is idempotent and skips monitors that are already seed data', async () => {
    await legacySetup();
    const demo = await workspaceFor('b@example.com');
    await seedInto(demo, { includeLocalDemo: true });
    const demoChecksBefore = await CheckResult.countDocuments({ isSeed: true });
    const demoIncidentsBefore = await Incident.countDocuments({ isSeed: true });

    await markLegacy(db());
    // The fictional monitors are backdated by design and keep all their data.
    expect(await CheckResult.countDocuments({ isSeed: true })).toBe(demoChecksBefore);
    expect(await Incident.countDocuments({ isSeed: true })).toBe(demoIncidentsBefore + 2);

    const again = await markLegacy(db());
    expect(again).toEqual({ incidentsMarked: 0, rollupsMarked: 0, checksDeleted: 0 });
  });
});
