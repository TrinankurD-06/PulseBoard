import { runHttpCheck } from '@pulseboard/shared/check';
import { MONITOR_STATUS } from '@pulseboard/shared/constants';
import { CheckResult, Monitor } from '@pulseboard/shared/models';

/**
 * Copies the latest result onto the Monitor document. Time-series collections
 * can't be watched by change streams, so this update is what the API's change
 * stream sees and pushes live to browsers (phase 6).
 *
 * The `isPaused: false` filter means a check that finishes just after the user
 * paused the monitor doesn't flip it back to up/down.
 *
 * NOTE: status here is a simple "last check wins"; phase 5 replaces it with
 * the incident state machine (3 failures -> down, 2 successes -> up).
 */
async function recordOnMonitor(monitor, result, checkedAt) {
  await Monitor.updateOne(
    { _id: monitor._id, isPaused: false },
    {
      $set: {
        status: result.ok ? MONITOR_STATUS.UP : MONITOR_STATUS.DOWN,
        lastCheckedAt: checkedAt,
        lastResponseMs: result.totalMs,
        lastOk: result.ok,
        lastStatusCode: result.statusCode,
        lastError: result.error,
        lastTimings: result.timings,
        ...(result.sslExpiresAt && { sslExpiresAt: result.sslExpiresAt }),
      },
    },
  );
}

/**
 * Handler for the repeating `run-check` job: run the HTTP check, store the raw
 * result in the time-series collection, update the monitor.
 * Check failures are normal data, not job failures, so this only throws when
 * the database itself fails.
 */
export function createRunCheckJob({ allowPrivate, scheduler, logger }) {
  return async function runCheckJob(job) {
    const { monitorId } = job.attrs.data;
    const monitor = await Monitor.findById(monitorId).lean();

    // A job without an active monitor is an orphan (deleted or paused while
    // the job was in flight): remove it instead of checking.
    if (!monitor || monitor.isPaused) {
      logger.warn({ monitorId }, 'Removing check job for missing or paused monitor');
      await scheduler.cancelMonitor(monitorId);
      return;
    }

    const result = await runHttpCheck(monitor, { allowPrivate });
    const checkedAt = new Date();

    await CheckResult.create({
      timestamp: checkedAt,
      meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
      ok: result.ok,
      statusCode: result.statusCode,
      error: result.error,
      totalMs: result.totalMs,
      timings: result.timings,
    });
    await recordOnMonitor(monitor, result, checkedAt);

    logger.debug(
      { monitorId, ok: result.ok, statusCode: result.statusCode, ms: result.totalMs },
      'Check finished',
    );
  };
}
