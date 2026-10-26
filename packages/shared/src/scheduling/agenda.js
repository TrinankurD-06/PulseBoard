// Agenda setup shared by the API (schedules jobs, never processes them) and the
// worker (processes jobs). Jobs live in MongoDB's `agendaJobs` collection, so
// MongoDB is the job queue: no Redis or other broker.
import { MongoBackend } from '@agendajs/mongo-backend';
import { Agenda } from 'agenda';
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
}) {
  const backend = new MongoBackend({ address: mongoUri, collection: AGENDA_COLLECTION });
  const agenda = new Agenda({ backend, name, processEvery, maxConcurrency, defaultLockLifetime });
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

/**
 * The scheduler interface used by the API and the worker's reconcile step.
 * One repeating `run-check` job per monitor, identified by data.monitorId.
 */
export function createAgendaScheduler(agenda) {
  return {
    /** Creates the job, or updates its interval if it exists (upsert on data.monitorId). */
    async scheduleMonitor(monitor) {
      const monitorId = String(monitor._id);
      await agenda
        .create(JOB_NAMES.RUN_CHECK, { monitorId })
        .repeatEvery(`${monitor.intervalSec} seconds`)
        .unique({ 'data.monitorId': monitorId })
        .save();
    },

    async cancelMonitor(monitorId) {
      await agenda.cancel({ name: JOB_NAMES.RUN_CHECK, data: { monitorId: String(monitorId) } });
    },
  };
}
