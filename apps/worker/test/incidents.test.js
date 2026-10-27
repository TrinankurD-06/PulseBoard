import { mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { AlertChannel, Incident, Monitor } from '@pulseboard/shared/models';
import { AGENDA_COLLECTION, createAgenda } from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import { createSendAlertJob } from '../src/jobs/sendAlert.js';

const logger = createLogger({ name: 'incident-test' });
let agenda, closeAgenda, jobs, processCheckResult;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  // Never started: we only inspect the jobs it would enqueue.
  ({ agenda, close: closeAgenda } = createAgenda({ mongoUri: replSet.getUri('pulseboard-test') }));
  await agenda.ready;
  jobs = mongoose.connection.db.collection(AGENDA_COLLECTION);
  processCheckResult = createIncidentEngine({ agenda, logger });
});

afterAll(async () => {
  await closeAgenda();
  await stopMemoryDb();
});

beforeEach(clearMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
const createMonitor = (overrides = {}) =>
  Monitor.create({
    workspaceId,
    name: 'API',
    url: 'https://api.example',
    intervalSec: 10,
    ...overrides,
  });

const failure = { ok: false, statusCode: 503, error: 'Unexpected status 503', totalMs: 12 };
const success = { ok: true, statusCode: 200, error: null, totalMs: 40 };
const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 10, 0, seconds));

/** Feeds results one by one, 10 s apart (like a 10 s interval). */
async function feed(monitor, results, startSecond = 0) {
  const transitions = [];
  for (const [i, result] of results.entries()) {
    const { transition } = await processCheckResult(monitor._id, result, at(startSecond + i * 10));
    transitions.push(transition);
  }
  return transitions.filter(Boolean);
}

const alertJobs = () => jobs.find({ name: 'send-alert' }).toArray();

describe('incident engine', () => {
  beforeEach(async () => {
    await AlertChannel.create([
      { workspaceId, type: 'discord', target: 'https://discord.com/api/webhooks/1/a' },
      { workspaceId, type: 'email', target: 'ops@example.com' },
      {
        workspaceId,
        type: 'slack',
        target: 'https://hooks.slack.com/services/T/B/x',
        isEnabled: false,
      },
    ]);
  });

  it('marks a pending monitor up on its first success, with no incident', async () => {
    const monitor = await createMonitor();
    expect(await feed(monitor, [success])).toEqual(['mark_up']);
    expect((await Monitor.findById(monitor._id)).status).toBe('up');
    expect(await Incident.countDocuments()).toBe(0);
  });

  it('opens ONE incident on the 3rd failure, starting at the 1st failure, and queues alerts', async () => {
    const monitor = await createMonitor({ status: 'up' });
    const transitions = await feed(monitor, [failure, failure, failure, failure, failure]);

    expect(transitions).toEqual(['open_incident']);
    const updated = await Monitor.findById(monitor._id).lean();
    expect(updated).toMatchObject({ status: 'down', consecutiveFailures: 5, lastOk: false });

    const [incident, ...others] = await Incident.find().lean();
    expect(others).toHaveLength(0);
    expect(incident.startedAt).toEqual(at(0)); // first failed check, not the 3rd
    expect(incident.cause).toBe('Unexpected status 503');
    expect(incident.resolvedAt).toBeNull();
    expect(incident.timeline[0].type).toBe('opened');

    // One "down" alert per ENABLED channel (Slack is disabled).
    const queued = await alertJobs();
    expect(queued.map((j) => j.data.kind)).toEqual(['down', 'down']);
    expect(queued.every((j) => j.data.attempt === 1)).toBe(true);
  });

  it('resolves after 2 successes with duration from first failure to first success', async () => {
    const monitor = await createMonitor({ status: 'up' });
    // failures at 0, 10, 20s; one blip of success at 30s; failure at 40s; successes at 50, 60s
    const transitions = await feed(monitor, [
      failure,
      failure,
      failure,
      success,
      failure,
      success,
      success,
    ]);

    expect(transitions).toEqual(['open_incident', 'resolve_incident']);
    const incident = await Incident.findOne().lean();
    expect(incident.resolvedAt).toEqual(at(50)); // first success of the final streak
    expect(incident.durationSec).toBe(50);
    expect(incident.timeline.map((e) => e.type)).toEqual(['opened', 'resolved']);
    expect((await Monitor.findById(monitor._id)).status).toBe('up');

    const kinds = (await alertJobs()).map((j) => j.data.kind).sort();
    expect(kinds).toEqual(['down', 'down', 'up', 'up']);
  });

  it('flapping never opens an incident', async () => {
    const monitor = await createMonitor({ status: 'up' });
    await feed(monitor, [failure, failure, success, failure, failure, success, failure]);
    expect(await Incident.countDocuments()).toBe(0);
    expect((await Monitor.findById(monitor._id)).status).toBe('up');
  });

  it('concurrent failing checks open exactly one incident (race safety)', async () => {
    const monitor = await createMonitor({ status: 'up' });
    // Eight checks of the same monitor finishing "at the same time", e.g. on
    // several workers. Counters must all be applied and only one transition win.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        processCheckResult(monitor._id, failure, at(i)).then((r) => r.transition),
      ),
    );
    expect(results.filter((t) => t === 'open_incident')).toHaveLength(1);
    expect(await Incident.countDocuments()).toBe(1);
    expect((await Monitor.findById(monitor._id)).consecutiveFailures).toBe(8);
    expect((await alertJobs()).length).toBe(2);
  });

  it('ignores results for a paused monitor', async () => {
    const monitor = await createMonitor({ isPaused: true, status: 'paused' });
    expect(await feed(monitor, [failure, failure, failure])).toEqual([]);
    expect(await Incident.countDocuments()).toBe(0);
  });

  it('treats a "$" in an error message as text, not a field path', async () => {
    const monitor = await createMonitor({ status: 'up' });
    await feed(monitor, [{ ...failure, error: '$consecutiveFailures' }]);
    expect((await Monitor.findById(monitor._id)).lastError).toBe('$consecutiveFailures');
  });
});

describe('send-alert job', () => {
  let monitor, channel, incident, sent, shouldFail;

  const senders = {
    discord: async (target, alert) => {
      if (shouldFail) throw new Error('HTTP 500: upstream error');
      sent.push({ target, title: alert.title });
    },
    email: async () => ({ previewUrl: 'https://ethereal.email/message/abc' }),
  };
  const runJob = (data) =>
    createSendAlertJob({ agenda, senders, dashboardUrl: 'http://localhost:5173', logger })({
      attrs: { data },
    });

  beforeEach(async () => {
    sent = [];
    shouldFail = false;
    monitor = await createMonitor({ status: 'down' });
    channel = await AlertChannel.create({
      workspaceId,
      name: 'ops',
      type: 'discord',
      target: 'https://discord.com/api/webhooks/1/a',
    });
    incident = await Incident.create({
      monitorId: monitor._id,
      workspaceId,
      startedAt: new Date(),
      cause: 'Connection refused',
    });
  });

  const data = (overrides = {}) => ({
    incidentId: String(incident._id),
    channelId: String(channel._id),
    kind: 'down',
    attempt: 1,
    ...overrides,
  });

  it('delivers once and records it in the timeline', async () => {
    await runJob(data());
    await runJob(data()); // duplicate job: must not send again

    expect(sent).toEqual([{ target: channel.target, title: '🔴 API is DOWN' }]);
    const updated = await Incident.findById(incident._id).lean();
    expect(updated.deliveredAlerts).toEqual([`${channel._id}:down`]);
    expect(updated.timeline.at(-1)).toMatchObject({
      type: 'alert_sent',
      message: 'Down alert via Discord (ops) sent',
    });
  });

  it('a "down" and an "up" alert for the same incident are both delivered', async () => {
    await runJob(data());
    await runJob(data({ kind: 'up' }));
    expect(sent).toHaveLength(2);
  });

  it('retries with backoff 30s -> 2m -> 8m, then gives up', async () => {
    shouldFail = true;
    const delays = [];
    for (const attempt of [1, 2, 3, 4]) {
      const before = Date.now();
      await runJob(data({ attempt }));
      const retry = await jobs.findOne({ name: 'send-alert', 'data.attempt': attempt + 1 });
      delays.push(retry ? Math.round((retry.nextRunAt - before) / 1000) : null);
    }
    expect(delays).toEqual([30, 120, 480, null]);

    const timeline = (await Incident.findById(incident._id).lean()).timeline;
    expect(timeline.map((e) => e.type)).toEqual(Array(4).fill('alert_failed'));
    expect(timeline[0].message).toMatch(/attempt 1\): HTTP 500: upstream error; retrying in 30s/);
    expect(timeline[3].message).toMatch(/attempt 4\).*giving up/);
  });

  it('skips disabled or deleted channels', async () => {
    await AlertChannel.updateOne({ _id: channel._id }, { isEnabled: false });
    await runJob(data());
    await runJob(data({ channelId: String(new mongoose.Types.ObjectId()) }));
    expect(sent).toHaveLength(0);
  });

  it('includes the email preview URL in the timeline (Ethereal in development)', async () => {
    const emailChannel = await AlertChannel.create({
      workspaceId,
      type: 'email',
      target: 'ops@example.com',
    });
    await runJob(data({ channelId: String(emailChannel._id) }));
    const { timeline } = await Incident.findById(incident._id).lean();
    expect(timeline.at(-1).message).toContain('preview: https://ethereal.email/message/abc');
  });
});
