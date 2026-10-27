import { randomBytes } from 'node:crypto';
import { JOB_NAMES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import { createLogger } from '@pulseboard/shared/logger';
import { AlertChannel, CheckResult, Incident, Monitor } from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHeartbeatOverdueJob, missedPingMessage } from '../src/jobs/heartbeatOverdue.js';
import { createRunCheckJob } from '../src/jobs/runCheck.js';
import { reconcileJobs } from '../src/reconcile.js';

const logger = createLogger({ name: 'heartbeat-test' });
let agenda, closeAgenda, scheduler, jobs, db, mongoUri, processCheckResult, overdue;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  mongoUri = replSet.getUri('pulseboard-test');
  ({ agenda, close: closeAgenda } = createAgenda({ mongoUri }));
  await agenda.ready;
  db = mongoose.connection.db;
  await ensureAgendaIndexes(db);
  scheduler = createAgendaScheduler(agenda);
  jobs = db.collection(AGENDA_COLLECTION);
  processCheckResult = createIncidentEngine({ agenda, logger });
  overdue = createHeartbeatOverdueJob({ processCheckResult, logger });
});

afterAll(async () => {
  await closeAgenda();
  await stopMemoryDb();
});

beforeEach(clearMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
const HOUR = 3600 * 1000;

/** A heartbeat expected hourly (+60 s grace) that was due at `dueAt`. */
const createHeartbeat = (dueAt, overrides = {}) =>
  Monitor.create({
    workspaceId,
    type: 'heartbeat',
    name: 'Nightly backup',
    expectedEverySec: 3600,
    graceSec: 60,
    heartbeatToken: randomBytes(32).toString('base64url'),
    status: 'up',
    nextDueAt: dueAt,
    ...overrides,
  });

const failures = (monitor) =>
  CheckResult.find({ 'meta.monitorId': monitor._id }).sort({ timestamp: 1 }).lean();
const stored = (monitor) => Monitor.findById(monitor._id).lean();

describe('heartbeat-overdue job', () => {
  it('does nothing before the due time, or for paused monitors', async () => {
    const now = new Date();
    await createHeartbeat(new Date(now.getTime() + 1000));
    await createHeartbeat(new Date(now.getTime() - 1000), { isPaused: true, status: 'paused' });
    expect(await overdue(now)).toBe(0);
    expect(await CheckResult.countDocuments()).toBe(0);
  });

  it('records one failure at the due time and opens an incident at once', async () => {
    const now = new Date();
    const dueAt = new Date(now.getTime() - 10_000);
    const monitor = await createHeartbeat(dueAt, { lastPingAt: new Date(dueAt - HOUR - 60_000) });
    await AlertChannel.create({
      workspaceId,
      type: 'discord',
      target: 'https://discord.com/api/webhooks/1/a',
    });

    expect(await overdue(now)).toBe(1);

    const [check] = await failures(monitor);
    expect(check).toMatchObject({
      ok: false,
      source: 'heartbeat',
      error: 'No ping received within 1h + 1m grace',
    });
    expect(check.timestamp).toEqual(dueAt);
    expect(missedPingMessage(monitor)).toBe(check.error);

    const after = await stored(monitor);
    expect(after.status).toBe('down');
    expect(after.nextDueAt).toEqual(new Date(dueAt.getTime() + HOUR));
    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident.startedAt).toEqual(dueAt);
    expect(incident.cause).toBe(check.error);
    expect(await jobs.countDocuments({ name: JOB_NAMES.SEND_ALERT })).toBe(1);

    // Running again before the next period changes nothing.
    expect(await overdue(now)).toBe(0);
    expect(await failures(monitor)).toHaveLength(1);
  });

  it('two detectors at once still record exactly one failure per missed period', async () => {
    const now = new Date();
    const monitor = await createHeartbeat(new Date(now.getTime() - 2 * HOUR - 1000));
    const counts = await Promise.all([overdue(now), overdue(now), overdue(now)]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(3);
    const checks = await failures(monitor);
    expect(checks).toHaveLength(3);
    expect(new Set(checks.map((check) => check.timestamp.getTime())).size).toBe(3);
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);
  });

  it('catches up a long outage period by period, at most 50 per run', async () => {
    const now = new Date();
    const firstDue = new Date(now.getTime() - 3 * HOUR - 1000);
    const monitor = await createHeartbeat(firstDue);
    expect(await overdue(now)).toBe(4);
    const checks = await failures(monitor);
    expect(checks.map((check) => check.timestamp.getTime() - firstDue.getTime())).toEqual([
      0,
      HOUR,
      2 * HOUR,
      3 * HOUR,
    ]);
    expect((await stored(monitor)).nextDueAt).toEqual(new Date(firstDue.getTime() + 4 * HOUR));

    const ancient = await createHeartbeat(new Date(now.getTime() - 100 * HOUR));
    expect(await overdue(now)).toBe(50);
    expect(await failures(ancient)).toHaveLength(50);
    expect(await overdue(now)).toBe(50);
  });

  it('a ping that moved the due time wins over the detector', async () => {
    const now = new Date();
    const monitor = await createHeartbeat(new Date(now.getTime() - 1000));
    // What the ping endpoint does between the detector's read and its claim.
    const stale = await stored(monitor);
    await Monitor.updateOne(
      { _id: monitor._id },
      { $set: { lastPingAt: now, nextDueAt: new Date(now.getTime() + HOUR) } },
    );
    // The detector's claim on the period it read now matches nothing.
    const claimed = await Monitor.updateOne(
      { _id: monitor._id, isPaused: false, nextDueAt: stale.nextDueAt },
      { $set: { nextDueAt: new Date() } },
    );
    expect(claimed.modifiedCount).toBe(0);
    expect(await overdue(now)).toBe(0);
  });

  it('a later successful check resolves the incident', async () => {
    const now = new Date();
    const monitor = await createHeartbeat(new Date(now.getTime() - 1000));
    await overdue(now);
    await processCheckResult(
      monitor._id,
      { ok: true, statusCode: null, error: null, totalMs: null, timings: null },
      new Date(),
    );
    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident.resolvedAt).toBeInstanceOf(Date);
    expect((await stored(monitor)).status).toBe('up');
  });
});

describe('heartbeat monitors and check jobs', () => {
  it('scheduleMonitor never creates a check job for a heartbeat (real Agenda)', async () => {
    const monitor = await createHeartbeat(new Date());
    await scheduler.scheduleMonitor(monitor.toObject());
    expect(await jobs.countDocuments({ name: JOB_NAMES.RUN_CHECK })).toBe(0);
  });

  it('reconcile removes a stray check job of a heartbeat and creates none', async () => {
    const monitor = await createHeartbeat(new Date());
    await jobs.insertOne({
      name: JOB_NAMES.RUN_CHECK,
      data: { monitorId: String(monitor._id) },
      repeatInterval: '60 seconds',
    });
    const counts = await reconcileJobs({ db, scheduler, logger });
    expect(counts).toMatchObject({ created: 0, removed: 1 });
    expect(await jobs.countDocuments({ name: JOB_NAMES.RUN_CHECK })).toBe(0);
  });

  it('a run-check job that points at a heartbeat removes itself without checking', async () => {
    const monitor = await createHeartbeat(new Date(Date.now() + HOUR));
    const { insertedId } = await jobs.insertOne({
      name: JOB_NAMES.RUN_CHECK,
      data: { monitorId: String(monitor._id) },
      repeatInterval: '60 seconds',
    });
    const runCheck = createRunCheckJob({
      allowPrivate: true,
      db,
      scheduler,
      processCheckResult,
      logger,
    });
    // The real job shape: Agenda's Mongo backend hands out _id as a hex string.
    const stored = await jobs.findOne({ _id: insertedId });
    await runCheck({ attrs: { ...stored, _id: insertedId.toHexString() } });
    expect(await jobs.countDocuments({ name: JOB_NAMES.RUN_CHECK })).toBe(0);
    expect(await CheckResult.countDocuments()).toBe(0);
  });
});

describe('with a real, started Agenda instance', () => {
  it('the heartbeat-overdue job runs and records the missed ping', async () => {
    const { agenda: live, close } = createAgenda({ mongoUri, processEvery: 200 });
    await live.ready;
    const detector = createHeartbeatOverdueJob({
      processCheckResult: createIncidentEngine({ agenda: live, logger }),
      logger,
    });
    // Defined exactly like the worker's index.js.
    live.define(JOB_NAMES.HEARTBEAT_OVERDUE, () => detector(new Date()));
    const monitor = await createHeartbeat(new Date(Date.now() - 1000));

    await live.every('30 seconds', JOB_NAMES.HEARTBEAT_OVERDUE);
    await live.start();
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (await stored(monitor)).status !== 'down') {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      await close();
    }

    expect(await failures(monitor)).toHaveLength(1);
    expect((await stored(monitor)).status).toBe('down');
    expect(await jobs.countDocuments({ name: JOB_NAMES.HEARTBEAT_OVERDUE })).toBe(1);
  }, 30_000);
});
