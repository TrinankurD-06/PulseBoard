import http from 'node:http';
import { monthKey } from '@pulseboard/shared/cost';
import { mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { AlertChannel, Incident, Monitor, MonitorUsage } from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBudgetEnforcer } from '../src/budget.js';
import { createIncidentEngine } from '../src/incidents/engine.js';
import { createBudgetResetJob } from '../src/jobs/budgetReset.js';
import { createRunCheckJob } from '../src/jobs/runCheck.js';
import { createSendNoticeJob } from '../src/jobs/sendNotice.js';
import { reconcileJobs } from '../src/reconcile.js';

const logger = createLogger({ name: 'u2-test' });
let agenda, closeAgenda, scheduler, jobs, db, server, targetUrl, mongoUri;
let respondWith = 200;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  mongoUri = replSet.getUri('pulseboard-test');
  ({ agenda, close: closeAgenda } = createAgenda({ mongoUri }));
  await agenda.ready;
  db = mongoose.connection.db;
  await ensureAgendaIndexes(db);
  scheduler = createAgendaScheduler(agenda);
  jobs = db.collection(AGENDA_COLLECTION);

  server = http.createServer((_req, res) => {
    res.statusCode = respondWith;
    res.end();
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
  Monitor.create({
    workspaceId,
    name: 'Adaptive',
    url: targetUrl,
    method: 'HEAD',
    intervalSec: 20,
    adaptive: true,
    minIntervalSec: 10,
    maxIntervalSec: 40,
    currentIntervalSec: 20,
    ...overrides,
  });

/** A job object like the one Agenda passes to the handler, read from the database. */
async function runningJob(monitor) {
  const stored = await jobs.findOne({ name: 'run-check', 'data.monitorId': String(monitor._id) });
  // Exactly like Agenda's Mongo backend: _id is a hex STRING, not an ObjectId.
  return { attrs: { ...stored, _id: stored?._id.toHexString(), lastRunAt: new Date() } };
}

const buildRunCheck = (extra = {}) =>
  createRunCheckJob({
    allowPrivate: true,
    db,
    scheduler,
    processCheckResult: createIncidentEngine({ agenda, logger }),
    logger,
    ...extra,
  });

async function runChecks(monitor, count, runCheck = buildRunCheck()) {
  for (let i = 0; i < count; i += 1) await runCheck(await runningJob(monitor));
}

const stored = async (monitor) => Monitor.findById(monitor._id).lean();
const storedJob = (monitor) =>
  jobs.findOne({ name: 'run-check', 'data.monitorId': String(monitor._id) });

describe('adaptive interval in the worker', () => {
  it('doubles after 10 successes and applies it to the running job and the stored job', async () => {
    const monitor = await createMonitor();
    await scheduler.scheduleMonitor(monitor);

    await runChecks(monitor, 9);
    expect((await stored(monitor)).currentIntervalSec).toBe(20);

    const job = await runningJob(monitor);
    await buildRunCheck()(job);

    expect((await stored(monitor)).currentIntervalSec).toBe(40);
    expect(job.attrs.repeatInterval).toBe('40 seconds');
    expect(job.attrs.nextRunAt.getTime()).toBe(job.attrs.lastRunAt.getTime() + 40_000);
    expect((await storedJob(monitor)).repeatInterval).toBe('40 seconds');
    expect((await stored(monitor)).responseEwmaMs).toBeGreaterThan(0);
  });

  it('drops to the fastest interval on a failure; the 3-failure incident rule is unchanged', async () => {
    const monitor = await createMonitor({ currentIntervalSec: 40, status: 'up' });
    await scheduler.scheduleMonitor(monitor);
    respondWith = 500;

    await runChecks(monitor, 1);
    expect((await stored(monitor)).currentIntervalSec).toBe(10);
    expect(await Incident.countDocuments()).toBe(0);

    await runChecks(monitor, 2);
    expect((await stored(monitor)).status).toBe('down');
    expect(await Incident.countDocuments()).toBe(1);
    expect((await storedJob(monitor)).repeatInterval).toBe('10 seconds');
  });

  it('leaves non-adaptive monitors on their base interval', async () => {
    const monitor = await createMonitor({ adaptive: false, currentIntervalSec: null });
    await scheduler.scheduleMonitor(monitor);
    respondWith = 500;
    await runChecks(monitor, 2);
    expect((await stored(monitor)).currentIntervalSec).toBeNull();
    expect((await storedJob(monitor)).repeatInterval).toBe('20 seconds');
  });

  it('self-heals: a job whose interval drifted from the monitor is corrected on its next run', async () => {
    const monitor = await createMonitor({
      currentIntervalSec: 40,
      status: 'up',
      consecutiveSuccesses: 3,
    });
    await scheduler.scheduleMonitor({ _id: monitor._id, intervalSec: 20, currentIntervalSec: 20 }); // drifted
    expect((await storedJob(monitor)).repeatInterval).toBe('20 seconds');

    await runChecks(monitor, 1);
    expect((await storedJob(monitor)).repeatInterval).toBe('40 seconds');
  });

  it('boot reconcile keeps an adapted interval instead of resetting it', async () => {
    const monitor = await createMonitor({ currentIntervalSec: 40 });
    await scheduler.scheduleMonitor(monitor);
    const counts = await reconcileJobs({ db, scheduler, logger });
    expect(counts).toEqual({ created: 0, updated: 0, removed: 0 });
    expect((await storedJob(monitor)).repeatInterval).toBe('40 seconds');
  });
});

describe('budget enforcement', () => {
  let enforceBudget;
  const noticeJobs = () => jobs.find({ name: 'send-notice' }).toArray();

  beforeEach(async () => {
    enforceBudget = createBudgetEnforcer({ agenda, db, scheduler, logger });
    await AlertChannel.create({ workspaceId, type: 'email', target: 'ops@example.com' });
  });

  it('warns once at 80%, then slows down once at 100%', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 10, budgetAction: 'slow' });
    await scheduler.scheduleMonitor(monitor);
    const runCheck = buildRunCheck({ enforceBudget });

    await runChecks(monitor, 7, runCheck);
    expect(await noticeJobs()).toHaveLength(0);

    await runChecks(monitor, 2, runCheck); // 8 and 9
    expect((await noticeJobs()).map((j) => j.data.noticeKind)).toEqual(['budget_warning']);
    expect((await noticeJobs())[0].data.details).toMatchObject({ requests: 8, budget: 10 });

    const job = await runningJob(monitor);
    await runCheck(job); // 10: budget reached
    const after = await stored(monitor);
    expect(after).toMatchObject({ budgetExceededMonth: monthKey(), currentIntervalSec: 900 });
    expect(job.attrs.repeatInterval).toBe('900 seconds');
    expect((await storedJob(monitor)).repeatInterval).toBe('900 seconds');

    await runChecks(monitor, 2, runCheck); // over budget: no more notices, still slow
    expect((await noticeJobs()).map((j) => j.data.noticeKind).sort()).toEqual([
      'budget_exceeded',
      'budget_warning',
    ]);
    expect((await storedJob(monitor)).repeatInterval).toBe('900 seconds');
  });

  it('pause: pauses the monitor, removes its job and closes the open incident', async () => {
    const monitor = await createMonitor({
      monthlyRequestBudget: 3,
      budgetAction: 'pause',
      status: 'down',
    });
    await scheduler.scheduleMonitor(monitor);
    await Incident.create({ monitorId: monitor._id, workspaceId, startedAt: new Date() });
    respondWith = 500; // still down, so the incident is open when the budget runs out

    await runChecks(monitor, 3, buildRunCheck({ enforceBudget }));

    expect(await stored(monitor)).toMatchObject({
      isPaused: true,
      status: 'paused',
      pausedReason: 'budget_exceeded',
      budgetExceededMonth: monthKey(),
    });
    expect(await storedJob(monitor)).toBeNull();
    const incident = await Incident.findOne().lean();
    expect(incident.resolvedAt).toBeInstanceOf(Date);
    expect(incident.timeline.at(-1).message).toMatch(/budget/);
  });

  it('jumping straight past 100% sends only the "reached" notice', async () => {
    const monitor = await createMonitor({ monthlyRequestBudget: 5 });
    await scheduler.scheduleMonitor(monitor);
    await MonitorUsage.create({
      monitorId: monitor._id,
      workspaceId,
      month: monthKey(),
      requests: 7,
    });
    await enforceBudget({ job: await runningJob(monitor), monitor, requests: 8 });
    expect((await noticeJobs()).map((j) => j.data.noticeKind)).toEqual(['budget_exceeded']);
  });

  it('does nothing without a budget', async () => {
    const monitor = await createMonitor();
    expect(await enforceBudget({ job: await runningJob(monitor), monitor, requests: 1e6 })).toBe(
      'none',
    );
    expect(await noticeJobs()).toHaveLength(0);
  });
});

describe('with a real, started Agenda instance', () => {
  it('a budget slow-down really changes the stored job (interval and next run)', async () => {
    const { agenda: live, close } = createAgenda({
      mongoUri,
      processEvery: 200, // ms
    });
    await live.ready;
    const liveScheduler = createAgendaScheduler(live);
    live.define(
      'run-check',
      createRunCheckJob({
        allowPrivate: true,
        db,
        scheduler: liveScheduler,
        processCheckResult: createIncidentEngine({ agenda: live, logger }),
        enforceBudget: createBudgetEnforcer({ agenda: live, db, scheduler: liveScheduler, logger }),
        logger,
      }),
    );

    const monitor = await createMonitor({ monthlyRequestBudget: 2, budgetAction: 'slow' });
    // A 1 s interval (below the model's minimum) so the test is quick: written
    // straight to the collection, bypassing validation.
    await Monitor.collection.updateOne(
      { _id: monitor._id },
      { $set: { intervalSec: 1, currentIntervalSec: 1, minIntervalSec: 1, maxIntervalSec: 2 } },
    );
    await liveScheduler.scheduleMonitor({
      _id: monitor._id,
      intervalSec: 1,
      currentIntervalSec: 1,
    });
    await live.start();
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !(await stored(monitor)).budgetExceededMonth) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await new Promise((resolve) => setTimeout(resolve, 500)); // let the run finish saving
    } finally {
      await close();
    }

    expect((await stored(monitor)).currentIntervalSec).toBe(900);
    const job = await storedJob(monitor);
    expect(job.repeatInterval).toBe('900 seconds');
    expect(job.nextRunAt.getTime() - job.lastRunAt.getTime()).toBe(900_000);
  }, 30_000);
});

describe('monthly budget reset', () => {
  it('restores budget-paused and budget-slowed monitors from earlier months only', async () => {
    const reset = createBudgetResetJob({ scheduler, logger });
    const paused = await createMonitor({
      name: 'paused',
      isPaused: true,
      status: 'paused',
      pausedReason: 'budget_exceeded',
      budgetExceededMonth: '2000-01',
    });
    const slowed = await createMonitor({
      name: 'slowed',
      budgetExceededMonth: '2000-01',
      currentIntervalSec: 900,
    });
    const userPaused = await createMonitor({
      name: 'user',
      isPaused: true,
      status: 'paused',
      pausedReason: 'user',
    });
    const thisMonth = await createMonitor({
      name: 'now',
      budgetExceededMonth: monthKey(),
      currentIntervalSec: 900,
    });

    expect(await reset(new Date())).toBe(2);

    expect(await stored(paused)).toMatchObject({
      isPaused: false,
      status: 'pending',
      pausedReason: null,
      budgetExceededMonth: null,
    });
    expect((await storedJob(paused)).repeatInterval).toBe('20 seconds');
    expect(await stored(slowed)).toMatchObject({
      currentIntervalSec: 20,
      budgetExceededMonth: null,
    });
    expect(await stored(userPaused)).toMatchObject({ isPaused: true, pausedReason: 'user' });
    expect(await stored(thisMonth)).toMatchObject({
      budgetExceededMonth: monthKey(),
      currentIntervalSec: 900,
    });
  });
});

describe('send-notice job', () => {
  it('delivers through the channel and retries with backoff on failure', async () => {
    const monitor = await createMonitor();
    const channel = await AlertChannel.create({
      workspaceId,
      type: 'discord',
      target: 'https://discord.com/api/webhooks/1/a',
    });
    const sent = [];
    let fail = false;
    const senders = {
      discord: async (_target, notice) => {
        if (fail) throw new Error('HTTP 500');
        sent.push(notice.title);
      },
    };
    const sendNotice = createSendNoticeJob({
      agenda,
      senders,
      dashboardUrl: 'http://localhost:5173',
      logger,
    });
    const data = {
      monitorId: String(monitor._id),
      channelId: String(channel._id),
      noticeKind: 'budget_warning',
      details: {
        requests: 8,
        budget: 10,
        month: '2026-10',
        budgetAction: 'slow',
        slowIntervalSec: 900,
      },
      attempt: 1,
    };

    await sendNotice({ attrs: { data } });
    expect(sent).toEqual(["⚠️ Adaptive: 80% of this month's request budget used"]);

    fail = true;
    await sendNotice({ attrs: { data } });
    const retry = await jobs.findOne({ name: 'send-notice', 'data.attempt': 2 });
    expect(retry.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 25_000);
  });
});
