import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENDA_COLLECTION,
  countOverdueJobs,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '../src/scheduling/agenda.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';

let closeAgenda, scheduler, jobs;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  const created = createAgenda({ mongoUri: replSet.getUri('pulseboard-test') });
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

const monitor = (intervalSec = 30) => ({ _id: new mongoose.Types.ObjectId(), intervalSec });

describe('agenda scheduler', () => {
  it('creates one repeating run-check job per monitor and updates it in place', async () => {
    const m = monitor(30);
    await scheduler.scheduleMonitor(m);
    await scheduler.scheduleMonitor({ ...m, intervalSec: 60 });

    const found = await jobs.find({ 'data.monitorId': String(m._id) }).toArray();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'run-check', repeatInterval: '60 seconds' });
  });

  it('cancels only the given monitor', async () => {
    const [a, b] = [monitor(), monitor()];
    await scheduler.scheduleMonitor(a);
    await scheduler.scheduleMonitor(b);
    await scheduler.cancelMonitor(a._id);
    const remaining = await jobs.find().toArray();
    expect(remaining.map((j) => j.data.monitorId)).toEqual([String(b._id)]);
  });

  it('counts due, unlocked jobs as overdue', async () => {
    await scheduler.scheduleMonitor(monitor()); // due immediately
    await jobs.insertOne({ name: 'x', nextRunAt: new Date(Date.now() + 60_000), lockedAt: null });
    await jobs.insertOne({ name: 'y', nextRunAt: new Date(0), lockedAt: new Date() });
    expect(await countOverdueJobs(mongoose.connection.db)).toBe(1);
  });

  it('has the one-job-per-monitor unique index', async () => {
    const indexes = await jobs.indexes();
    expect(indexes.find((i) => i.name === 'one_run_check_per_monitor')).toMatchObject({
      unique: true,
      partialFilterExpression: { name: 'run-check' },
    });
  });
});
