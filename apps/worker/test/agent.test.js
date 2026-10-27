import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { JOB_NAMES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import { createLogger } from '@pulseboard/shared/logger';
import {
  AlertChannel,
  CheckResult,
  Incident,
  Monitor,
  MonitorUsage,
} from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAgentProber } from '../src/agentProbes.js';
import { createAgentSilenceJob } from '../src/jobs/agentSilence.js';
import { createRunCheckJob } from '../src/jobs/runCheck.js';
import { reconcileJobs } from '../src/reconcile.js';

const logger = createLogger({ name: 'agent-test' });
const SPACING_MS = 5; // instead of 10 s between probes
let agenda, closeAgenda, scheduler, jobs, db, mongoUri, processCheckResult;
let prober, silence, waits, target, probeUrl;
// What the customer's endpoint answers (HEAD probes): set per test.
let targetStatus = 200;

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

  target = createServer((_req, res) => res.writeHead(targetStatus).end());
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  probeUrl = `http://127.0.0.1:${target.address().port}/health`;
});

afterAll(async () => {
  await new Promise((resolve) => target.close(resolve));
  await closeAgenda();
  await stopMemoryDb();
});

beforeEach(async () => {
  await clearMemoryDb();
  targetStatus = 200;
  waits = [];
  prober = createAgentProber({
    allowPrivate: true,
    agenda,
    processCheckResult,
    logger,
    spacingMs: SPACING_MS,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  silence = createAgentSilenceJob({ prober, processCheckResult, logger });
});

const workspaceId = new mongoose.Types.ObjectId();
const SEC = 1000;

/** An agent reporting every 60 s whose last report was `silentSec` before `now`. */
const createAgent = (now, silentSec, overrides = {}) =>
  Monitor.create({
    workspaceId,
    type: 'agent',
    name: 'Shop API',
    agentKeyHash: randomBytes(32).toString('hex'),
    agentKeyPrefix: 'pbk_test',
    reportEverySec: 60,
    errorRateThreshold: 5,
    status: 'up',
    silenceState: 'reporting',
    lastReportAt: new Date(now - silentSec * SEC),
    watchSince: new Date(now - 3600 * SEC),
    ...overrides,
  });

const stored = (monitor) => Monitor.findById(monitor._id).lean();
const results = (monitor, source) =>
  CheckResult.find({ 'meta.monitorId': monitor._id, ...(source && { source }) })
    .sort({ timestamp: 1 })
    .lean();
const noticeJobs = () => jobs.find({ name: JOB_NAMES.SEND_NOTICE }).toArray();
const addChannel = () =>
  AlertChannel.create({
    workspaceId,
    type: 'discord',
    target: 'https://discord.com/api/webhooks/1/a',
  });

describe('agent-silence job', () => {
  it('leaves reporting agents (under 2 report periods) and paused ones alone', async () => {
    const now = new Date();
    await createAgent(now, 100, { probeUrl });
    await createAgent(now, 500, { probeUrl, isPaused: true, status: 'paused' });
    expect(await silence(now)).toEqual({ silenced: 0, reprobed: 0, failures: 0 });
    expect(await CheckResult.countDocuments()).toBe(0);
  });

  it('silence -> 3 failing probes, 10 s apart -> incident; then nothing more while down', async () => {
    targetStatus = 503;
    const now = new Date();
    const monitor = await createAgent(now, 130, { probeUrl });
    expect(await silence(now)).toMatchObject({ silenced: 1 });

    const probes = await results(monitor, 'probe');
    expect(probes).toHaveLength(3);
    expect(probes.every((probe) => !probe.ok && probe.statusCode === 503)).toBe(true);
    expect(waits).toEqual([SPACING_MS, SPACING_MS]);
    const usage = await MonitorUsage.findOne({ monitorId: monitor._id }).lean();
    expect(usage.requests).toBe(3);

    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident.resolvedAt).toBeNull();
    expect(incident.cause).toMatch(/503/);
    expect(await stored(monitor)).toMatchObject({ status: 'down', silenceState: 'silent' });

    expect(await silence(new Date(now.getTime() + 600 * SEC))).toMatchObject({ reprobed: 0 });
    expect(await results(monitor, 'probe')).toHaveLength(3);
  });

  it('silence -> probe OK -> degraded and exactly one notice; re-probes every 5 minutes', async () => {
    await addChannel();
    const now = new Date();
    const monitor = await createAgent(now, 130, { probeUrl });
    await silence(now);

    expect(await results(monitor, 'probe')).toHaveLength(1);
    const after = await stored(monitor);
    expect(after).toMatchObject({ status: 'degraded', silenceState: 'silent' });
    expect(after.silentNoticeAt).toBeInstanceOf(Date);
    const notices = await noticeJobs();
    expect(notices).toHaveLength(1);
    expect(notices[0].data).toMatchObject({
      monitorId: String(monitor._id),
      noticeKind: 'agent_silent',
      details: { silentSec: 130 },
    });
    expect(await Incident.countDocuments()).toBe(0);

    // Within 5 minutes: no new probe.
    await silence(new Date(now.getTime() + 60 * SEC));
    expect(await results(monitor, 'probe')).toHaveLength(1);
    // After 5 minutes: probed again, still reachable, still a single notice.
    expect(await silence(new Date(now.getTime() + 301 * SEC))).toMatchObject({ reprobed: 1 });
    expect(await results(monitor, 'probe')).toHaveLength(2);
    expect(await noticeJobs()).toHaveLength(1);
    expect((await stored(monitor)).status).toBe('degraded');

    // The endpoint dies too: the next re-probe opens the incident.
    targetStatus = 503;
    await silence(new Date(now.getTime() + 602 * SEC));
    expect(await results(monitor, 'probe')).toHaveLength(5);
    expect(await stored(monitor)).toMatchObject({ status: 'down', silenceState: 'silent' });
    expect(await Incident.countDocuments({ monitorId: monitor._id, resolvedAt: null })).toBe(1);
  });

  it('without a probe URL: one failure per run while silent, incident after 3 runs', async () => {
    const now = new Date();
    const monitor = await createAgent(now, 130);
    await silence(now);
    const [first] = await results(monitor, 'agent');
    expect(first).toMatchObject({ ok: false, error: 'No report for 130 s' });
    expect((await stored(monitor)).silenceState).toBe('silent');

    await silence(new Date(now.getTime() + 30 * SEC));
    expect(await Incident.countDocuments()).toBe(0);
    await silence(new Date(now.getTime() + 60 * SEC));
    const failures = await results(monitor, 'agent');
    expect(failures.map((f) => f.error)).toEqual([
      'No report for 130 s',
      'No report for 160 s',
      'No report for 190 s',
    ]);
    expect((await stored(monitor)).status).toBe('down');
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);

    await silence(new Date(now.getTime() + 90 * SEC));
    expect(await results(monitor, 'agent')).toHaveLength(3);
    expect(await MonitorUsage.countDocuments()).toBe(0); // nothing was sent to the customer
  });

  it('a never-reporting agent goes silent 2 periods after it was created / resumed', async () => {
    const now = new Date();
    const fresh = await createAgent(now, 0, {
      lastReportAt: null,
      watchSince: new Date(now - 100 * SEC),
    });
    const resumed = await createAgent(now, 3 * 86400, { watchSince: new Date(now - 60 * SEC) });
    const old = await createAgent(now, 0, {
      lastReportAt: null,
      watchSince: new Date(now - 121 * SEC),
    });
    expect(await silence(now)).toMatchObject({ silenced: 1 });
    expect((await stored(fresh)).silenceState).toBe('reporting');
    expect((await stored(resumed)).silenceState).toBe('reporting');
    expect((await stored(old)).silenceState).toBe('silent');
  });

  it('two detector runs at once handle each silence once', async () => {
    targetStatus = 503;
    const now = new Date();
    const monitor = await createAgent(now, 130, { probeUrl });
    const [a, b] = await Promise.all([silence(now), silence(now)]);
    expect(a.silenced + b.silenced).toBe(1);
    expect(await results(monitor, 'probe')).toHaveLength(3);
    expect(await Incident.countDocuments()).toBe(1);
  });

  it('a report arriving during the probes stops them and keeps "reporting"', async () => {
    targetStatus = 503;
    const now = new Date();
    const monitor = await createAgent(now, 130, { probeUrl });
    // The API's report handler, simulated during the pause after the first probe.
    prober = createAgentProber({
      allowPrivate: true,
      agenda,
      processCheckResult,
      logger,
      spacingMs: SPACING_MS,
      sleep: () =>
        Monitor.updateOne(
          { _id: monitor._id },
          { silenceState: 'reporting', lastReportAt: new Date() },
        ),
    });
    silence = createAgentSilenceJob({ prober, processCheckResult, logger });
    await silence(now);
    expect(await results(monitor, 'probe')).toHaveLength(1);
    expect((await stored(monitor)).silenceState).toBe('reporting');
    expect(await Incident.countDocuments()).toBe(0);
  });

  it("recovers a 'probing' state left behind by a crashed worker", async () => {
    const now = new Date();
    const monitor = await createAgent(now, 3600, {
      silenceState: 'probing',
      lastProbeAt: new Date(now - 11 * 60 * SEC),
    });
    await silence(now);
    expect((await stored(monitor)).silenceState).toBe('silent');
  });
});

describe('external check (run-check for agent monitors)', () => {
  const runCheckJob = () =>
    createRunCheckJob({ allowPrivate: true, db, scheduler, processCheckResult, logger, prober });

  /** Schedules the monitor with the real scheduler and returns the job as Agenda hands it out. */
  async function scheduledJob(monitor) {
    await scheduler.scheduleMonitor(monitor);
    const job = await jobs.findOne({
      name: JOB_NAMES.RUN_CHECK,
      'data.monitorId': String(monitor._id),
    });
    return { attrs: { ...job, _id: job._id.toHexString() }, touch: async () => {} };
  }

  it('the scheduler and reconcile give agents a job only with an external check', async () => {
    const now = new Date();
    const plain = await createAgent(now, 0, { probeUrl });
    const external = await createAgent(now, 0, { probeUrl, externalCheckEverySec: 900 });
    await scheduler.scheduleMonitor(plain);
    await jobs.insertOne({
      name: JOB_NAMES.RUN_CHECK,
      data: { monitorId: String(plain._id) },
      repeatInterval: '60 seconds',
    });

    const counts = await reconcileJobs({ db, scheduler, logger });
    expect(counts).toMatchObject({ created: 1, removed: 1 });
    const all = await jobs.find({ name: JOB_NAMES.RUN_CHECK }).toArray();
    expect(all.map((job) => [job.data.monitorId, job.repeatInterval])).toEqual([
      [String(external._id), '900 seconds'],
    ]);
  });

  it('success is recorded (source external, counted) but not fed to the engine', async () => {
    const monitor = await createAgent(new Date(), 0, { probeUrl, externalCheckEverySec: 900 });
    await runCheckJob()(await scheduledJob(monitor));
    const [check] = await results(monitor);
    expect(check).toMatchObject({ ok: true, source: 'external', statusCode: 200 });
    expect((await MonitorUsage.findOne({ monitorId: monitor._id }).lean()).requests).toBe(1);
    const after = await stored(monitor);
    expect(after.lastCheckedAt).toBeNull();
    expect(after.consecutiveSuccesses).toBe(0);
  });

  it('a failure starts the 3-probe confirmation, which opens the incident', async () => {
    targetStatus = 503;
    const monitor = await createAgent(new Date(), 0, { probeUrl, externalCheckEverySec: 900 });
    await runCheckJob()(await scheduledJob(monitor));
    expect((await results(monitor, 'external')).length).toBe(1);
    expect((await results(monitor, 'probe')).length).toBe(3);
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);
    // The agent is still reporting: back to 'reporting' after the confirmation.
    expect(await stored(monitor)).toMatchObject({ status: 'down', silenceState: 'reporting' });
    expect((await MonitorUsage.findOne({ monitorId: monitor._id }).lean()).requests).toBe(4);
  });

  it('a run-check job of an agent without external check removes itself', async () => {
    const monitor = await createAgent(new Date(), 0, { probeUrl });
    const { insertedId } = await jobs.insertOne({
      name: JOB_NAMES.RUN_CHECK,
      data: { monitorId: String(monitor._id) },
      repeatInterval: '60 seconds',
    });
    const job = await jobs.findOne({ _id: insertedId });
    await runCheckJob()({ attrs: { ...job, _id: insertedId.toHexString() } });
    expect(await jobs.countDocuments({ name: JOB_NAMES.RUN_CHECK })).toBe(0);
    expect(await CheckResult.countDocuments()).toBe(0);
  });
});

describe('with a real, started Agenda instance', () => {
  it('the agent-silence job runs, probes a dead endpoint and opens the incident', async () => {
    targetStatus = 503;
    const { agenda: live, close } = createAgenda({ mongoUri, processEvery: 200 });
    await live.ready;
    const liveEngine = createIncidentEngine({ agenda: live, logger });
    const liveProber = createAgentProber({
      allowPrivate: true,
      agenda: live,
      processCheckResult: liveEngine,
      logger,
      spacingMs: 20,
    });
    const detector = createAgentSilenceJob({
      prober: liveProber,
      processCheckResult: liveEngine,
      logger,
    });
    // Defined exactly like the worker's index.js (job.touch keeps the lock).
    live.define(JOB_NAMES.AGENT_SILENCE, (job) =>
      detector(new Date(), { touch: () => job.touch() }),
    );
    const monitor = await createAgent(new Date(), 130, { probeUrl });

    await live.every('30 seconds', JOB_NAMES.AGENT_SILENCE);
    await live.start();
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (await stored(monitor)).silenceState !== 'silent') {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      await close();
    }

    expect(await results(monitor, 'probe')).toHaveLength(3);
    expect(await stored(monitor)).toMatchObject({ status: 'down', silenceState: 'silent' });
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);
    expect(await jobs.countDocuments({ name: JOB_NAMES.AGENT_SILENCE })).toBe(1);
  }, 30_000);
});
