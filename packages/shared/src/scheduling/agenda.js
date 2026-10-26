// Agenda setup shared by the API (schedules jobs, never processes them) and the
// worker (processes jobs). Jobs live in MongoDB's `agendaJobs` collection, so
// MongoDB is the job queue: no Redis or other broker.
import { MongoBackend } from '@agendajs/mongo-backend';
import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { JOB_NAMES } from '../constants.js';

export const AGENDA_COLLECTION = 'agendaJobs';

/**
 * Creates an Agenda instance with its own MongoDB connection. Returns the
 * instance plus `close()`, which releases locks held by this process and closes
 * the connection. (agenda.stop() alone doesn't close an instance that was never
 * started, which is the API's case.)
 *
 * defaultLockLifetime must exceed the longest check (30s max timeout), otherwise
 * Agenda would think a slow check had died and hand it to another worker.
 */
export function createAgenda({
  mongoUri,
  name,
  processEvery = '5 seconds',
  maxConcurrency = 20,
  defaultLockLifetime = 60_000,
  removeOnComplete = false,
}) {
  const backend = new MongoBackend({ address: mongoUri, collection: AGENDA_COLLECTION });
  const agenda = new Agenda({
    backend,
    name,
    processEvery,
    maxConcurrency,
    defaultLockLifetime,
    removeOnComplete,
  });
  async function close() {
    await agenda.stop(false);
    await backend.disconnect();
  }
  return { agenda, close };
}

/**
 * Extra indexes on top of the one Agenda creates (name + priority + lockedAt +
 * nextRunAt + disabled, used to find and lock the next due job).
 */
export async function ensureAgendaIndexes(db) {
  await db.collection(AGENDA_COLLECTION).createIndexes([
    // Database-level guarantee of ONE check job per monitor, even if two
    // processes upsert at the same moment.
    {
      key: { 'data.monitorId': 1 },
      name: 'one_run_check_per_monitor',
      unique: true,
      partialFilterExpression: { name: JOB_NAMES.RUN_CHECK },
    },
    // Worker health: "how many jobs are due but not yet picked up?"
    { key: { nextRunAt: 1, lockedAt: 1 }, name: 'due_jobs' },
  ]);
}

/** Number of jobs that are due now but not locked by any worker (a backlog indicator). */
export function countOverdueJobs(db) {
  return db.collection(AGENDA_COLLECTION).countDocuments({
    nextRunAt: { $lte: new Date() },
    lockedAt: null,
    disabled: { $ne: true },
  });
}

/** Seconds between checks the job should use: the current interval, else the base one. */
export const repeatSecondsOf = (monitor) => monitor.currentIntervalSec ?? monitor.intervalSec;

/**
 * Changes the interval of a run-check job FROM INSIDE its own run (adaptive
 * intervals, budget slow-down).
 *
 * Agenda computes nextRunAt when a run starts and, when the run ends, saves
 * nextRunAt from the in-memory job (overwriting anything written to the
 * database meanwhile) but not repeatInterval. So both are set in memory, so the
 * post-run save keeps them, and repeatInterval is also written to the database,
 * so future runs (loaded from the database) use it.
 */
export async function applyIntervalToRunningJob(job, db, seconds) {
  const repeatInterval = `${seconds} seconds`;
  const from = job.attrs.lastRunAt ? new Date(job.attrs.lastRunAt).getTime() : Date.now();
  const nextRunAt = new Date(from + seconds * 1000);
  job.attrs.repeatInterval = repeatInterval;
  job.attrs.nextRunAt = nextRunAt;

  const result = await db
    .collection(AGENDA_COLLECTION)
    .updateOne(storedJobFilter(job), { $set: { repeatInterval, nextRunAt } });
  // false = the stored job is gone (e.g. deleted mid-run); the caller decides whether to log.
  return result.matchedCount === 1;
}

/**
 * Filter that finds a job's stored document. Agenda hands handlers job
 * objects whose `_id` is a hex STRING (not an ObjectId), so it must be
 * converted; run-check jobs can also be found by their unique monitorId.
 */
function storedJobFilter(job) {
  const id = job.attrs._id != null ? String(job.attrs._id) : null;
  if (id && /^[a-f\d]{24}$/i.test(id)) {
    return { _id: new mongoose.Types.ObjectId(id) };
  }
  return { name: job.attrs.name, 'data.monitorId': job.attrs.data?.monitorId };
}

/**
 * The scheduler interface used by the API and the worker's reconcile step.
 * One repeating `run-check` job per monitor, identified by data.monitorId.
 */
export function createAgendaScheduler(agenda) {
  return {
    /**
     * Creates the job, or updates its interval if it exists (upsert on
     * data.monitorId). Uses the CURRENT interval (adaptive / budget-slowed),
     * falling back to the base interval, so rescheduling never undoes adaptation.
     */
    async scheduleMonitor(monitor) {
      const monitorId = String(monitor._id);
      await agenda
        .create(JOB_NAMES.RUN_CHECK, { monitorId })
        .repeatEvery(`${repeatSecondsOf(monitor)} seconds`)
        .unique({ 'data.monitorId': monitorId })
        .save();
    },

    async cancelMonitor(monitorId) {
      await agenda.cancel({ name: JOB_NAMES.RUN_CHECK, data: { monitorId: String(monitorId) } });
    },
  };
}
