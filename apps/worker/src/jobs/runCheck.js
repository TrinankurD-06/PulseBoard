import { runHttpCheck } from '@pulseboard/shared/check';
import { CheckResult, Monitor } from '@pulseboard/shared/models';
import { recordUsage } from '@pulseboard/shared/usage';
import { applyAdaptiveInterval } from '../adaptive.js';

const noopEnforceBudget = async () => 'none';

/**
 * Handler for the repeating `run-check` job:
 *   1. run the HTTP check and count the requests it sent (MonitorUsage)
 *   2. store the raw result in the time-series collection
 *   3. hand it to the incident engine, which updates the monitor's live
 *      fields and counters and opens/resolves incidents
 *   4. adaptive interval: decide the next interval and apply it to this job
 *   5. budget: warn at 80 %, pause or slow down at 100 %
 *
 * Check failures are normal data, not job failures, so this only throws when
 * the database itself fails.
 */
export function createRunCheckJob({
  allowPrivate,
  appUrl,
  db,
  scheduler,
  processCheckResult,
  enforceBudget = noopEnforceBudget,
  logger,
}) {
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

    const result = await runHttpCheck(monitor, { allowPrivate, appUrl });
    const checkedAt = new Date();

    // Count what was actually sent to the customer (redirects and a HEAD->GET
    // fallback included), and remember a server that rejects HEAD so later
    // checks go straight to GET instead of paying for two requests.
    const requests = await recordUsage(monitor, result.requestsSent, checkedAt);
    if (result.headUnsupported && !monitor.headUnsupported) {
      await Monitor.updateOne({ _id: monitor._id }, { headUnsupported: true });
    }

    await CheckResult.create({
      timestamp: checkedAt,
      meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
      ok: result.ok,
      statusCode: result.statusCode,
      error: result.error,
      totalMs: result.totalMs,
      timings: result.timings,
    });
    const { monitor: counted } = await processCheckResult(monitor._id, result, checkedAt);

    // Adaptive first, budget second: a budget slow-down must win over the
    // interval adaptation of the same run.
    if (counted && db) {
      await applyAdaptiveInterval({ job, db, monitor: counted, result, checkedAt, logger });
    }
    await enforceBudget({ job, monitor, requests, at: checkedAt });

    logger.debug(
      { monitorId, ok: result.ok, statusCode: result.statusCode, ms: result.totalMs },
      'Check finished',
    );
  };
}
