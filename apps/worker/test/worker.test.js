import http from 'node:http';
import { mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { monthKey } from '@pulseboard/shared/cost';
import { CheckResult, Monitor, MonitorUsage } from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import { createRunCheckJob } from '../src/jobs/runCheck.js';
import { reconcileJobs } from '../src/reconcile.js';

const logger = createLogger({ name: 'worker-test' });
let replSet, agenda, closeAgenda, scheduler, jobs, server, targetUrl;
let respondWith = 200;

beforeAll(async () => {
  replSet = await startMemoryDb();
  ({ agenda, close: closeAgenda } = createAgenda({ mongoUri: replSet.getUri('pulseboard-test') }));
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  scheduler = createAgendaScheduler(agenda);
  jobs = mongoose.connection.db.collection(AGENDA_COLLECTION);

  server = http.createServer((req, res) => {
    // "/no-head" behaves like a server that doesn't implement HEAD.
    res.statusCode = req.url === '/no-head' && req.method === 'HEAD' ? 405 : respondWith;
    res.end('healthy');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${server.address().port}/`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeAgenda();
  await stopMemoryDb();
});

beforeEach(async () => {
  await clearMemoryDb();
  respondWith = 200;
});

const workspaceId = new mongoose.Types.ObjectId();
const createMonitor = (overrides = {}) =>
  Monitor.create({ workspaceId, name: 'Target', url: targetUrl, intervalSec: 60, ...overrides });

describe('reconcileJobs', () => {
  it('creates missing jobs, fixes intervals, and removes orphans and duplicates', async () => {
    const missing = await createMonitor({ name: 'missing' });
    const stale = await createMonitor({ name: 'stale', intervalSec: 120 });
    const paused = await createMonitor({ name: 'paused', isPaused: true });

    // Stale job: wrong interval. Orphans: paused monitor and deleted monitor.
    await jobs.insertMany([
      { name: 'run-check', data: { monitorId: String(stale._id) }, repeatInterval: '60 seconds' },
      { name: 'run-check', data: { monitorId: String(paused._id) }, repeatInterval: '60 seconds' },
      { name: 'run-check', data: { monitorId: 'deleted-monitor' }, repeatInterval: '60 seconds' },
    ]);

    const counts = await reconcileJobs({ db: mongoose.connection.db, scheduler, logger });

    expect(counts).toEqual({ created: 1, updated: 1, removed: 2 });
    const remaining = await jobs.find({ name: 'run-check' }).toArray();
    const byMonitor = Object.fromEntries(
      remaining.map((j) => [j.data.monitorId, j.repeatInterval]),
    );
    expect(byMonitor).toEqual({
      [String(missing._id)]: '60 seconds',
      [String(stale._id)]: '120 seconds',
    });
  });

  it('is idempotent', async () => {
    await createMonitor();
    await reconcileJobs({ db: mongoose.connection.db, scheduler, logger });
    const second = await reconcileJobs({ db: mongoose.connection.db, scheduler, logger });
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(await jobs.countDocuments({ name: 'run-check' })).toBe(1);
  });
});

describe('one job per monitor', () => {
  it('scheduling twice updates the same job instead of creating a second one', async () => {
    const monitor = await createMonitor();
    await scheduler.scheduleMonitor(monitor);
    await scheduler.scheduleMonitor({ _id: monitor._id, intervalSec: 300 });
    const found = await jobs.find({ 'data.monitorId': String(monitor._id) }).toArray();
    expect(found).toHaveLength(1);
    expect(found[0].repeatInterval).toBe('300 seconds');
  });

  it('the database rejects a duplicate run-check job for the same monitor', async () => {
    await jobs.insertOne({ name: 'run-check', data: { monitorId: 'm1' } });
    await expect(jobs.insertOne({ name: 'run-check', data: { monitorId: 'm1' } })).rejects.toThrow(
      /duplicate key/,
    );
  });
});

describe('run-check job handler', () => {
  // Built per call: `scheduler` only exists once beforeAll has run.
  const runJob = (job) =>
    createRunCheckJob({
      allowPrivate: true,
      scheduler,
      processCheckResult: createIncidentEngine({ agenda, logger }),
      logger,
    })(job);
  const fakeJob = (monitorId) => ({ attrs: { data: { monitorId: String(monitorId) } } });

  it('stores a time-series result and updates the monitor live fields', async () => {
    const monitor = await createMonitor();
    await runJob(fakeJob(monitor._id));

    const [result] = await CheckResult.find().lean();
    expect(result).toMatchObject({ ok: true, statusCode: 200 });
    expect(String(result.meta.monitorId)).toBe(String(monitor._id));

    const updated = await Monitor.findById(monitor._id).lean();
    expect(updated).toMatchObject({ lastOk: true, lastStatusCode: 200, lastError: null });
    expect(updated.lastCheckedAt).toBeInstanceOf(Date);
    expect(updated.lastResponseMs).toBeGreaterThan(0);
    expect(updated.lastTimings).toHaveProperty('ttfbMs');
  });

  it('records failures as data, not as job errors', async () => {
    respondWith = 503;
    const monitor = await createMonitor();
    await expect(runJob(fakeJob(monitor._id))).resolves.toBeUndefined();
    const updated = await Monitor.findById(monitor._id).lean();
    expect(updated).toMatchObject({ lastOk: false, lastStatusCode: 503 });
    expect(updated.lastError).toMatch(/Unexpected status 503/);
  });

  it('removes its own job when the monitor no longer exists (orphan)', async () => {
    const monitor = await createMonitor();
    await scheduler.scheduleMonitor(monitor);
    await monitor.deleteOne();

    await runJob(fakeJob(monitor._id));

    expect(await jobs.countDocuments({ 'data.monitorId': String(monitor._id) })).toBe(0);
    expect(await CheckResult.countDocuments()).toBe(0);
  });

  it('does not overwrite the status of a monitor paused mid-check', async () => {
    const monitor = await createMonitor();
    const job = runJob(fakeJob(monitor._id));
    await Monitor.updateOne({ _id: monitor._id }, { isPaused: true, status: 'paused' });
    await job;
    expect((await Monitor.findById(monitor._id).lean()).status).toBe('paused');
  });

  it('counts every request sent in MonitorUsage for the current month', async () => {
    const monitor = await createMonitor();
    await runJob(fakeJob(monitor._id));
    await runJob(fakeJob(monitor._id));

    const [usage, ...others] = await MonitorUsage.find().lean();
    expect(others).toHaveLength(0);
    expect(usage).toMatchObject({ month: monthKey(new Date()), requests: 2 });
    expect(String(usage.workspaceId)).toBe(String(workspaceId));
  });

  it('remembers a server that rejects HEAD, so later checks use GET directly', async () => {
    const monitor = await createMonitor({ url: `${targetUrl}no-head`, method: 'HEAD' });

    await runJob(fakeJob(monitor._id)); // HEAD (405) + GET = 2 requests
    expect((await Monitor.findById(monitor._id).lean()).headUnsupported).toBe(true);

    await runJob(fakeJob(monitor._id)); // straight to GET = 1 request
    expect((await MonitorUsage.findOne().lean()).requests).toBe(3);
    expect((await Monitor.findById(monitor._id).lean()).lastOk).toBe(true);
  });
});
