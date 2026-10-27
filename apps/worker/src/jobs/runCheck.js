import { guardNetworkFailure, runHttpCheck } from '@pulseboard/shared/check';
import {
  AGENT_SILENCE_STATE,
  CHECK_SOURCES,
  CHECK_STATE,
  MONITOR_TYPES,
} from '@pulseboard/shared/constants';
import { CheckResult, Monitor } from '@pulseboard/shared/models';
import { needsCheckJob } from '@pulseboard/shared/scheduling';
import { recordUsage } from '@pulseboard/shared/usage';
import { applyAdaptiveInterval } from '../adaptive.js';

const noopEnforceBudget = async () => 'none';

/**
 * Handler for the repeating `run-check` job:
 *   1. run the HTTP check and count the requests it sent (MonitorUsage)
 *   2. store the raw result in the time-series collection; a network failure
 *      is first checked against reference hosts (guardNetworkFailure): if the
 *      checker itself is offline the result is 'unknown', stored and counted as
 *      usage but NOT fed to the engine, adaptive interval or budget
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
  prober,
  guard = guardNetworkFailure,
}) {
  /**
   * External check of an agent monitor (U4): a HEAD to its probeUrl, stored
   * as source 'external' and counted, but NOT fed to the engine on its own.
   * A failure starts the 3-probe confirmation (which is), so a single network
   * blip never opens an incident. 'probing' doubles as a lock against the
   * silence detector probing the same monitor at the same time.
   */
  async function runExternalCheck(monitor, job) {
    const { result } = await prober.probeOnce(monitor, CHECK_SOURCES.EXTERNAL);
    if (result.ok) return;
    // Checker offline: inconclusive, retried on the next cycle.
    if (result.state === CHECK_STATE.UNKNOWN) return;
    const before = await Monitor.findOneAndUpdate(
      { _id: monitor._id, isPaused: false, silenceState: { $ne: AGENT_SILENCE_STATE.PROBING } },
      { $set: { silenceState: AGENT_SILENCE_STATE.PROBING, lastProbeAt: new Date() } },
      { projection: { silenceState: 1 } },
    ).lean();
    if (!before) return; // already being probed
    logger.warn({ monitorId: monitor._id, error: result.error }, 'External check failed, probing');
    const outcome = await prober.confirm(monitor._id, { touch: () => job.touch?.() });
    const previous = before.silenceState ?? AGENT_SILENCE_STATE.REPORTING;
    await Monitor.updateOne(
      { _id: monitor._id, silenceState: AGENT_SILENCE_STATE.PROBING },
      { $set: { silenceState: previous } },
    );
    if (outcome === 'reachable' && previous === AGENT_SILENCE_STATE.SILENT) {
      await prober.markReachable(monitor._id);
    }
  }

  return async function runCheckJob(job) {
    const { monitorId } = job.attrs.data;
    const monitor = await Monitor.findById(monitorId).lean();

    // A job without an active polled monitor is an orphan (deleted or paused
    // while the job was in flight, or a heartbeat monitor, which is never
    // polled): remove it instead of checking.
    if (!monitor || monitor.isPaused || !needsCheckJob(monitor)) {
      logger.warn({ monitorId }, 'Removing check job for missing or paused monitor');
      await scheduler.cancelMonitor(monitorId);
      return;
    }

    if (monitor.type === MONITOR_TYPES.AGENT) {
      await runExternalCheck(monitor, job);
      return;
    }

    const result = await guard(await runHttpCheck(monitor, { allowPrivate, appUrl }));
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
      errorCode: result.errorCode ?? null,
      state: result.state,
      unknownReason: result.unknownReason ?? null,
      totalMs: result.totalMs,
      timings: result.timings,
      source: CHECK_SOURCES.HTTP,
    });

    // The checker was offline: we know nothing about the target. No incident
    // engine, no adaptive interval, no budget check (the request still counted).
    if (result.state === CHECK_STATE.UNKNOWN) {
      logger.warn(
        { monitorId, errorCode: result.errorCode, reason: result.unknownReason },
        'Checker offline: result stored as unknown, not counted',
      );
      return;
    }
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
