import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENDA_COLLECTION,
  applyIntervalToRunningJob,
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

  it('schedules with the current (adaptive) interval when there is one', async () => {
    const m = { ...monitor(60), currentIntervalSec: 240 };
    await scheduler.scheduleMonitor(m);
    const job = await jobs.findOne({ 'data.monitorId': String(m._id) });
    expect(job.repeatInterval).toBe('240 seconds');
  });

  it('applyIntervalToRunningJob updates the in-memory job and the stored repeatInterval', async () => {
    const m = monitor(60);
    await scheduler.scheduleMonitor(m);
    const stored = await jobs.findOne({ 'data.monitorId': String(m._id) });
    const lastRunAt = new Date('2026-10-15T12:00:00Z');
    const job = { attrs: { ...stored, lastRunAt } };

    await applyIntervalToRunningJob(job, mongoose.connection.db, 480);

    // In memory: Agenda's post-run save writes nextRunAt from here.
    expect(job.attrs.repeatInterval).toBe('480 seconds');
    expect(job.attrs.nextRunAt).toEqual(new Date(lastRunAt.getTime() + 480_000));
    // Stored: future runs are loaded from the database.
    const after = await jobs.findOne({ _id: stored._id });
    expect(after.repeatInterval).toBe('480 seconds');
    expect(after.nextRunAt).toEqual(job.attrs.nextRunAt);
  });

  it('works with job objects as Agenda passes them (hex-string _id)', async () => {
    const m = monitor(60);
    await scheduler.scheduleMonitor(m);
    const stored = await jobs.findOne({ 'data.monitorId': String(m._id) });
    // Agenda's Mongo backend builds handler job objects with _id as a hex STRING.
    const job = {
      attrs: { ...stored, _id: stored._id.toHexString(), lastRunAt: new Date() },
    };

    expect(await applyIntervalToRunningJob(job, mongoose.connection.db, 300)).toBe(true);
    const after = await jobs.findOne({ _id: stored._id });
    expect(after.repeatInterval).toBe('300 seconds');
    expect(after.nextRunAt).toEqual(job.attrs.nextRunAt);
  });

  it('reports false when the stored job no longer exists', async () => {
    const m = monitor(60);
    await scheduler.scheduleMonitor(m);
    const stored = await jobs.findOne({ 'data.monitorId': String(m._id) });
    await scheduler.cancelMonitor(m._id);
    const job = { attrs: { ...stored, _id: stored._id.toHexString() } };
    expect(await applyIntervalToRunningJob(job, mongoose.connection.db, 300)).toBe(false);
  });

  it('has the one-job-per-monitor unique index', async () => {
    const indexes = await jobs.indexes();
    expect(indexes.find((i) => i.name === 'one_run_check_per_monitor')).toMatchObject({
      unique: true,
      partialFilterExpression: { name: 'run-check' },
    });
  });
});
