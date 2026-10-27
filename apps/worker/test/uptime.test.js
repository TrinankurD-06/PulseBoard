import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { guardNetworkFailure } from '@pulseboard/shared/check';
import { mongoose } from '@pulseboard/shared/db';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import { createLogger } from '@pulseboard/shared/logger';
import { CheckResult, Incident, Monitor, MonitorUsage } from '@pulseboard/shared/models';
import { createAgenda } from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentProber } from '../src/agentProbes.js';
import { createAgentSilenceJob } from '../src/jobs/agentSilence.js';
import { createHeartbeatOverdueJob } from '../src/jobs/heartbeatOverdue.js';
import { createRunCheckJob } from '../src/jobs/runCheck.js';

const logger = createLogger({ name: 'uptime-test' });
let agenda, closeAgenda, processCheckResult, server, targetUrl;
let targetStatus = 200;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  ({ agenda, close: closeAgenda } = createAgenda({ mongoUri: replSet.getUri('pulseboard-test') }));
  await agenda.ready;
  processCheckResult = createIncidentEngine({ agenda, logger });
  server = createServer((_req, res) => res.writeHead(targetStatus).end('healthy'));
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
  targetStatus = 200;
});

const workspaceId = new mongoose.Types.ObjectId();
const fakeJob = (monitorId) => ({
  attrs: { data: { monitorId: String(monitorId) } },
  touch: async () => {},
});
const offline = async () => ({ online: false });
const online = async () => ({ online: true });
// Turns whatever the runner returned into a network failure, then runs the real guard.
const networkFailure = (probe) => async (result) =>
  guardNetworkFailure(
    { ...result, ok: false, error: 'Connection timed out', errorCode: 'ETIMEDOUT' },
    { probe },
  );

describe('run-check: checker offline', () => {
  const build = (extra = {}) =>
    createRunCheckJob({
      allowPrivate: true,
      db: mongoose.connection.db,
      scheduler: { cancelMonitor: vi.fn() },
      processCheckResult,
      logger,
      ...extra,
    });
  const createMonitor = (overrides = {}) =>
    Monitor.create({
      workspaceId,
      name: 'Target',
      url: targetUrl,
      intervalSec: 60,
      adaptive: true,
      ...overrides,
    });

  it('stores an unknown result, counts the request, and touches nothing else', async () => {
    const monitor = await createMonitor();
    const engine = vi.fn(processCheckResult);
    const enforceBudget = vi.fn();
    const job = build({
      processCheckResult: engine,
      enforceBudget,
      guard: networkFailure(offline),
    });

    await job(fakeJob(monitor._id));

    const [check] = await CheckResult.find().lean();
    expect(check).toMatchObject({
      ok: false,
      state: 'unknown',
      unknownReason: 'checker_offline',
      errorCode: 'ETIMEDOUT',
      error: 'Connection timed out',
    });
    expect((await MonitorUsage.findOne({ monitorId: monitor._id }).lean()).requests).toBe(1);

    expect(engine).not.toHaveBeenCalled();
    expect(enforceBudget).not.toHaveBeenCalled();
    const after = await Monitor.findById(monitor._id).lean();
    expect(after).toMatchObject({
      status: 'pending',
      consecutiveFailures: 0,
      lastCheckedAt: null,
      currentIntervalSec: null,
    });
    expect(await Incident.countDocuments()).toBe(0);
  });

  it('never opens an incident, however many unknown results arrive', async () => {
    const monitor = await createMonitor({ status: 'up' });
    const job = build({ guard: networkFailure(offline) });
    for (let i = 0; i < 5; i += 1) await job(fakeJob(monitor._id));
    expect(await Incident.countDocuments()).toBe(0);
    expect(await CheckResult.countDocuments({ state: 'unknown' })).toBe(5);
    expect((await Monitor.findById(monitor._id).lean()).consecutiveFailures).toBe(0);
  });

  it('a network failure while the internet is reachable is a real, counted failure', async () => {
    const monitor = await createMonitor({ status: 'up' });
    const enforceBudget = vi.fn();
    const job = build({ enforceBudget, guard: networkFailure(online) });
    await job(fakeJob(monitor._id));

    const [check] = await CheckResult.find().lean();
    expect(check).toMatchObject({ ok: false, state: 'failed', errorCode: 'ETIMEDOUT' });
    expect(check.unknownReason).toBeNull();
    expect((await Monitor.findById(monitor._id).lean()).consecutiveFailures).toBe(1);
    expect(enforceBudget).toHaveBeenCalledOnce();
  });

  it('stores state ok on success and code + state on an HTTP failure', async () => {
    const monitor = await createMonitor({ status: 'up' });
    const job = build();
    await job(fakeJob(monitor._id));
    targetStatus = 503;
    await job(fakeJob(monitor._id));
    const checks = await CheckResult.find().sort({ timestamp: 1 }).lean();
    expect(checks.map((c) => [c.state, c.errorCode])).toEqual([
      ['ok', null],
      ['failed', 'HTTP_503'],
    ]);
  });

  it('the incident keeps the opening failure code (causeCode and the opened entry)', async () => {
    targetStatus = 503;
    const monitor = await createMonitor({ status: 'up' });
    const job = build();
    for (let i = 0; i < 3; i += 1) await job(fakeJob(monitor._id));

    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident.causeCode).toBe('HTTP_503');
    expect(incident.timeline[0]).toMatchObject({ type: 'opened', code: 'HTTP_503' });
    expect(incident.timeline[0].message).toMatch(/Down after 3 consecutive failed checks/);
  });
});

describe('error codes: heartbeat and agent', () => {
  it('the overdue detector records HEARTBEAT_MISSED and the incident carries it', async () => {
    const dueAt = new Date(Date.now() - 10_000);
    const monitor = await Monitor.create({
      workspaceId,
      type: 'heartbeat',
      name: 'Backup',
      expectedEverySec: 3600,
      graceSec: 60,
      heartbeatToken: randomBytes(32).toString('base64url'),
      status: 'up',
      nextDueAt: dueAt,
    });
    await createHeartbeatOverdueJob({ processCheckResult, logger })(new Date());

    const [check] = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(check).toMatchObject({ errorCode: 'HEARTBEAT_MISSED', state: 'failed' });
    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident.causeCode).toBe('HEARTBEAT_MISSED');
    expect(incident.timeline[0].code).toBe('HEARTBEAT_MISSED');
  });

  const SEC = 1000;
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
  const buildProber = (guard) =>
    createAgentProber({
      allowPrivate: true,
      agenda,
      processCheckResult,
      logger,
      sleep: async () => {},
      guard,
    });

  it('a silent agent without a probe URL records AGENT_SILENT', async () => {
    const now = new Date();
    const monitor = await createAgent(now, 130);
    const silence = createAgentSilenceJob({
      prober: buildProber(async (r) => r),
      processCheckResult,
      logger,
    });
    for (let i = 0; i < 3; i += 1) await silence(new Date(now.getTime() + i * 30 * SEC));

    const checks = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(checks.length).toBe(3);
    expect(checks.every((c) => c.errorCode === 'AGENT_SILENT' && c.state === 'failed')).toBe(true);
    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident.causeCode).toBe('AGENT_SILENT');
  });

  it('probes keep their own code (HTTP_503) and state', async () => {
    targetStatus = 503;
    const now = new Date();
    const monitor = await createAgent(now, 130, { probeUrl: targetUrl });
    const silence = createAgentSilenceJob({
      prober: buildProber(guardNetworkFailure),
      processCheckResult,
      logger,
    });
    await silence(now);
    const probes = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(probes).toHaveLength(3);
    expect(probes.every((p) => p.errorCode === 'HTTP_503' && p.state === 'failed')).toBe(true);
    expect((await Incident.findOne({ monitorId: monitor._id }).lean()).causeCode).toBe('HTTP_503');
  });

  const unknownGuard = networkFailure(offline);

  it('an inconclusive probe (checker offline) opens nothing and is retried next cycle', async () => {
    const now = new Date();
    const monitor = await createAgent(now, 130, { probeUrl: targetUrl });
    const silence = createAgentSilenceJob({
      prober: buildProber(unknownGuard),
      processCheckResult,
      logger,
    });
    expect(await silence(now)).toMatchObject({ silenced: 1 });

    // One unknown probe stored (sequence stops), counted as usage, never fed to the engine.
    const probes = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ state: 'unknown', unknownReason: 'checker_offline' });
    expect((await MonitorUsage.findOne({ monitorId: monitor._id }).lean()).requests).toBe(1);
    const after = await Monitor.findById(monitor._id).lean();
    expect(after).toMatchObject({
      status: 'up',
      silenceState: 'reporting',
      consecutiveFailures: 0,
    });
    expect(await Incident.countDocuments()).toBe(0);

    // Next cycle: the agent is still overdue, so it is probed again.
    expect(await silence(new Date(now.getTime() + 30 * SEC))).toMatchObject({ silenced: 1 });
    expect(await CheckResult.countDocuments({ 'meta.monitorId': monitor._id })).toBe(2);
  });

  it('a silent, degraded agent whose re-probe is inconclusive stays silent and degraded', async () => {
    const now = new Date();
    const monitor = await createAgent(now, 900, {
      probeUrl: targetUrl,
      status: 'degraded',
      silenceState: 'silent',
      lastProbeAt: new Date(now.getTime() - 3600 * SEC),
    });
    const silence = createAgentSilenceJob({
      prober: buildProber(unknownGuard),
      processCheckResult,
      logger,
    });
    expect(await silence(now)).toMatchObject({ reprobed: 1 });
    expect(await Monitor.findById(monitor._id).lean()).toMatchObject({
      status: 'degraded',
      silenceState: 'silent',
    });
  });

  it('the external check, when inconclusive, stores it but starts no confirmation', async () => {
    const monitor = await createAgent(new Date(), 0, {
      probeUrl: targetUrl,
      externalCheckEverySec: 900,
    });
    const job = createRunCheckJob({
      allowPrivate: true,
      db: mongoose.connection.db,
      scheduler: { cancelMonitor: vi.fn() },
      processCheckResult,
      logger,
      prober: buildProber(unknownGuard),
    });
    await job(fakeJob(monitor._id));

    const checks = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ source: 'external', state: 'unknown' });
    expect(await Monitor.findById(monitor._id).lean()).toMatchObject({
      silenceState: 'reporting',
      status: 'up',
    });
    expect(await Incident.countDocuments()).toBe(0);
  });
});
