import { JOB_NAMES } from '@pulseboard/shared/constants';
import { Monitor } from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  CHECK_JOB_FIELDS,
  CHECK_JOB_MONITOR_FILTER,
  repeatSecondsOf,
} from '@pulseboard/shared/scheduling';

/**
 * Makes the job table match the monitors table, run once on worker boot:
 *   - every active http monitor has exactly one run-check job with its CURRENT
 *     interval (adaptive/budget-slowed intervals are kept, not reset to the base)
 *   - jobs for deleted/paused/heartbeat monitors (orphans) and duplicates are removed
 *
 * Normally the API keeps both in sync, but a crash between "save monitor" and
 * "save job", a manual DB edit, or a restore from backup could leave them
 * apart. Reconciling on boot makes the system self-healing.
 */
export async function reconcileJobs({ db, scheduler, logger }) {
  const jobs = db.collection(AGENDA_COLLECTION);
  // Only polled monitors (http, agent with an external check): leftover jobs of
  // heartbeat / other agent monitors count as orphans.
  const activeMonitors = await Monitor.find(
    { isPaused: false, ...CHECK_JOB_MONITOR_FILTER },
    { ...CHECK_JOB_FIELDS },
  ).lean();
  const activeById = new Map(activeMonitors.map((monitor) => [String(monitor._id), monitor]));

  const existingJobs = await jobs
    .find({ name: JOB_NAMES.RUN_CHECK }, { projection: { data: 1, repeatInterval: 1 } })
    .toArray();

  const counts = { created: 0, updated: 0, removed: 0 };
  const covered = new Set();

  for (const job of existingJobs) {
    const monitorId = job.data?.monitorId;
    const monitor = activeById.get(monitorId);
    if (!monitor || covered.has(monitorId)) {
      await jobs.deleteOne({ _id: job._id });
      counts.removed += 1;
      continue;
    }
    covered.add(monitorId);
    if (job.repeatInterval !== `${repeatSecondsOf(monitor)} seconds`) {
      await scheduler.scheduleMonitor(monitor);
      counts.updated += 1;
    }
  }

  for (const monitor of activeMonitors) {
    if (covered.has(String(monitor._id))) continue;
    try {
      await scheduler.scheduleMonitor(monitor);
      counts.created += 1;
    } catch (err) {
      // Another worker reconciling at the same moment may have just created it
      // (the unique index on data.monitorId rejects the second insert).
      if (err?.code !== 11000) throw err;
    }
  }

  logger.info({ ...counts, activeMonitors: activeMonitors.length }, 'Reconciled check jobs');
  return counts;
}
