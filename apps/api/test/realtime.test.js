import http from 'node:http';
import { mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { Incident, Membership, Monitor } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { io as connectClient } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenService } from '../src/lib/tokens.js';
import { incidentChangeToEvent, monitorChangeToEvent } from '../src/realtime/events.js';
import { startRealtime } from '../src/realtime/index.js';
import { createSocketServer } from '../src/realtime/socketServer.js';
import { testEnv } from './helpers.js';

const logger = createLogger({ name: 'realtime-test' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `predicate()` is truthy (change streams are asynchronous). */
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('Timed out waiting for condition');
}

/** Stand-in for Socket.io's `io`: records io.to(room).emit(event, payload). */
function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  };
}

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
const createMonitor = () =>
  Monitor.create({ workspaceId, name: 'API', url: 'https://x.example', intervalSec: 30 });

describe('event mapping', () => {
  it('sends live monitor fields to the workspace room, but never headers', () => {
    const mapped = monitorChangeToEvent({
      fullDocument: {
        _id: 'm1',
        workspaceId: 'w1',
        status: 'up',
        lastResponseMs: 120,
        headers: { Authorization: 'secret' },
      },
    });
    expect(mapped).toMatchObject({
      room: 'workspace:w1',
      event: 'check:result',
      payload: { monitorId: 'm1', status: 'up', lastResponseMs: 120 },
    });
    expect(mapped.payload.headers).toBeUndefined();
  });

  it('classifies incident changes', () => {
    const doc = { _id: 'i1', monitorId: 'm1', workspaceId: 'w1', startedAt: new Date() };
    expect(incidentChangeToEvent({ operationType: 'insert', fullDocument: doc }).event).toBe(
      'incident:opened',
    );
    expect(
      incidentChangeToEvent({
        operationType: 'update',
        fullDocument: { ...doc, resolvedAt: new Date() },
        updateDescription: { updatedFields: { resolvedAt: new Date(), durationSec: 5 } },
      }).event,
    ).toBe('incident:resolved');
    expect(
      incidentChangeToEvent({
        operationType: 'update',
        fullDocument: doc,
        updateDescription: { updatedFields: { 'timeline.1': {} } },
      }).event,
    ).toBe('incident:updated');
    expect(incidentChangeToEvent({ operationType: 'update', fullDocument: null })).toBeNull();
  });
});

describe('change streams -> socket events', () => {
  let io, realtime;

  beforeEach(async () => {
    io = fakeIo();
    realtime = startRealtime({ io, db: mongoose.connection.db, logger });
    await realtime.ready;
    await sleep(300); // let the change stream cursors open
  });

  const stop = () => realtime.close();

  it("updating a monitor's last* fields emits check:result to its workspace room", async () => {
    const monitor = await createMonitor();
    await Monitor.updateOne(
      { _id: monitor._id },
      { lastCheckedAt: new Date(), lastResponseMs: 87, lastOk: true, status: 'up' },
    );

    const event = await waitFor(() => io.emitted.find((e) => e.event === 'check:result'));
    expect(event).toMatchObject({
      room: `workspace:${workspaceId}`,
      payload: { monitorId: String(monitor._id), lastResponseMs: 87, status: 'up' },
    });
    expect(realtime.status()).toEqual({ monitors: 'live', incidents: 'live' });
    await stop();
  });

  it('ignores monitor edits that are not check results (e.g. a rename)', async () => {
    const monitor = await createMonitor();
    await Monitor.updateOne({ _id: monitor._id }, { name: 'Renamed' });
    await Monitor.updateOne({ _id: monitor._id }, { lastCheckedAt: new Date() }); // marker
    await waitFor(() => io.emitted.length >= 1);
    await sleep(200);
    expect(io.emitted).toHaveLength(1);
    await stop();
  });

  it('agent silence changes (U4) are pushed live with lastReportAt and silenceState', async () => {
    const monitor = await createMonitor();
    const lastReportAt = new Date();
    await Monitor.updateOne({ _id: monitor._id }, { lastReportAt, silenceState: 'reporting' });
    await Monitor.updateOne({ _id: monitor._id }, { silenceState: 'probing' });

    await waitFor(() => io.emitted.filter((e) => e.event === 'check:result').length >= 2);
    const [first, second] = io.emitted.filter((e) => e.event === 'check:result');
    expect(new Date(first.payload.lastReportAt)).toEqual(lastReportAt);
    expect(second.payload).toMatchObject({ silenceState: 'probing' });
    await stop();
  });

  it('inserting an incident emits incident:opened; resolving emits incident:resolved', async () => {
    const monitor = await createMonitor();
    const incident = await Incident.create({
      monitorId: monitor._id,
      workspaceId,
      startedAt: new Date(),
      cause: 'Connection refused',
    });
    const opened = await waitFor(() => io.emitted.find((e) => e.event === 'incident:opened'));
    expect(opened.payload).toMatchObject({ id: String(incident._id), cause: 'Connection refused' });

    await Incident.updateOne({ _id: incident._id }, { resolvedAt: new Date(), durationSec: 42 });
    const resolved = await waitFor(() => io.emitted.find((e) => e.event === 'incident:resolved'));
    expect(resolved.payload.durationSec).toBe(42);
    await stop();
  });

  it('resumes after a restart without losing events (resume token)', async () => {
    const monitor = await createMonitor();
    await Monitor.updateOne({ _id: monitor._id }, { lastCheckedAt: new Date(), lastResponseMs: 1 });
    await waitFor(() => io.emitted.length === 1);
    await stop(); // flushes the resume token

    const checkpoint = await mongoose.connection.db
      .collection('streamCheckpoints')
      .findOne({ _id: 'monitors' });
    expect(checkpoint.token).toBeTruthy();

    // A check result is written while the API is "down".
    await Monitor.updateOne({ _id: monitor._id }, { lastCheckedAt: new Date(), lastResponseMs: 2 });

    const io2 = fakeIo();
    realtime = startRealtime({ io: io2, db: mongoose.connection.db, logger });
    await realtime.ready;
    const missed = await waitFor(() => io2.emitted.find((e) => e.event === 'check:result'));
    expect(missed.payload.lastResponseMs).toBe(2);
    await stop();
  });
});

describe('Socket.io server', () => {
  let server, ioServer, url;
  const tokens = createTokenService(testEnv);
  const userId = new mongoose.Types.ObjectId();
  const clients = [];

  beforeAll(async () => {
    server = http.createServer();
    ioServer = createSocketServer(server, { env: testEnv, tokens, logger });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    clients.forEach((client) => client.close());
    await new Promise((resolve) => ioServer.close(resolve));
  });

  function connect(token) {
    const client = connectClient(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(client);
    return client;
  }

  it('rejects connections without a valid access token', async () => {
    const client = connect('not-a-token');
    const error = await new Promise((resolve) => client.on('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
  });

  it('delivers events only for workspaces the user belongs to', async () => {
    const otherWorkspace = new mongoose.Types.ObjectId();
    await Membership.create({ workspaceId, userId, role: 'viewer' });

    const client = connect(tokens.signAccessToken(userId));
    const received = [];
    client.on('check:result', (payload) => received.push(payload));
    await new Promise((resolve) => client.on('connect', resolve));
    await sleep(100); // room joins happen right after connect

    ioServer.to(`workspace:${otherWorkspace}`).emit('check:result', { monitorId: 'not-mine' });
    ioServer.to(`workspace:${workspaceId}`).emit('check:result', { monitorId: 'mine' });

    await waitFor(() => received.length > 0);
    await sleep(100);
    expect(received).toEqual([{ monitorId: 'mine' }]);
  });

  it('re-syncs rooms on request (e.g. after joining a workspace)', async () => {
    const client = connect(tokens.signAccessToken(userId));
    await new Promise((resolve) => client.on('connect', resolve));
    await Membership.create({ workspaceId, userId, role: 'member' });
    const ack = await client.timeout(2000).emitWithAck('workspaces:sync');
    expect(ack).toEqual({ rooms: 1 });
  });
});
