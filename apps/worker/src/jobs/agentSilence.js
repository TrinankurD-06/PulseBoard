import { reportEverySecOf, SILENT_SINCE_EXPR, silentSinceOf } from '@pulseboard/shared/agent';
import {
  AGENT_DEFAULT_REPORT_EVERY_SEC,
  AGENT_REPROBE_EVERY_SEC,
  AGENT_SILENCE_PERIODS,
  AGENT_SILENCE_STATE,
  CHECK_SOURCES,
  CHECK_STATE,
  MONITOR_STATUS,
  MONITOR_TYPES,
} from '@pulseboard/shared/constants';
import { CheckResult, Monitor } from '@pulseboard/shared/models';

const { REPORTING, PROBING, SILENT } = AGENT_SILENCE_STATE;
// Far longer than a probe sequence (3 probes, 2 pauses, timeouts) can take.
const STALE_PROBING_MS = 10 * 60 * 1000;

/**
 * Handler for the repeating `agent-silence` job (every 30 s). Agent monitors
 * push reports; this notices when they stop:
 *
 *   reporting --(no report for 2 report periods)--> probing --> silent
 *
 * The move to 'probing' is a conditional update (still 'reporting', same
 * lastReportAt), so with several workers exactly one handles each silence.
 *   - with a probeUrl: up to 3 HEAD probes (see agentProbes.js). All failing
 *     open an incident through the engine; any success means the app is up
 *     but the agent isn't reporting: 'degraded' and one "agent silent" notice.
 *   - without one: one failure ("No report for 130 s") now and on every
 *     later run while silent, so the incident opens after 3 runs.
 * While silent and degraded, the probes repeat every 5 minutes. A report
 * (API) puts the monitor back to 'reporting'.
 *
 * Returns how many monitors went silent / were probed again / got a failure.
 */
export function createAgentSilenceJob({
  prober,
  processCheckResult,
  logger,
  reprobeEverySec = AGENT_REPROBE_EVERY_SEC,
}) {
  async function recordSilenceFailure(monitor, now) {
    const silentSec = Math.round((now - silentSinceOf(monitor)) / 1000);
    const result = {
      ok: false,
      statusCode: null,
      error: `No report for ${silentSec} s`,
      errorCode: 'AGENT_SILENT',
      totalMs: null,
      timings: null,
    };
    await CheckResult.create({
      timestamp: now,
      meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
      ok: false,
      error: result.error,
      errorCode: result.errorCode,
      state: CHECK_STATE.FAILED,
      source: CHECK_SOURCES.AGENT,
    });
    await processCheckResult(monitor._id, result, now);
  }

  /**
   * Probes (or records a failure), then 'silent' unless a report arrived
   * meanwhile. An inconclusive probe (checker offline) changes nothing: the
   * monitor goes back to `previous` and is handled again on a later run.
   */
  async function handleSilence(monitor, now, touch, previous = REPORTING) {
    if (monitor.probeUrl) {
      const outcome = await prober.confirm(monitor._id, { touch });
      if (outcome === 'inconclusive') {
        await Monitor.updateOne(
          { _id: monitor._id, silenceState: PROBING },
          { $set: { silenceState: previous } },
        );
        return;
      }
      if (outcome === 'reachable') await prober.markReachable(monitor._id, now);
    } else {
      await recordSilenceFailure(monitor, now);
    }
    await Monitor.updateOne(
      { _id: monitor._id, silenceState: PROBING },
      { $set: { silenceState: SILENT } },
    );
  }

  return async function agentSilence(now = new Date(), { touch } = {}) {
    const counts = { silenced: 0, reprobed: 0, failures: 0 };
    const work = [];
    const handled = new Set();

    // 0. A worker that died mid-probe leaves 'probing' behind: treat it as silent.
    await Monitor.updateMany(
      {
        type: MONITOR_TYPES.AGENT,
        silenceState: PROBING,
        lastProbeAt: { $lt: new Date(now - STALE_PROBING_MS) },
      },
      { $set: { silenceState: SILENT } },
    );

    // 1. Reporting agents that missed two report periods.
    const overdue = await Monitor.find({
      type: MONITOR_TYPES.AGENT,
      isPaused: false,
      silenceState: REPORTING,
      $expr: {
        $lt: [
          SILENT_SINCE_EXPR,
          {
            $subtract: [
              now,
              {
                $multiply: [
                  { $ifNull: ['$reportEverySec', AGENT_DEFAULT_REPORT_EVERY_SEC] },
                  AGENT_SILENCE_PERIODS * 1000,
                ],
              },
            ],
          },
        ],
      },
    }).lean();
    for (const monitor of overdue) {
      const claim = await Monitor.updateOne(
        {
          _id: monitor._id,
          isPaused: false,
          silenceState: REPORTING,
          lastReportAt: monitor.lastReportAt,
          watchSince: monitor.watchSince,
        },
        { $set: { silenceState: PROBING, lastProbeAt: now } },
      );
      if (claim.modifiedCount !== 1) continue; // a report arrived, or another worker won
      counts.silenced += 1;
      handled.add(String(monitor._id));
      logger.warn(
        { monitorId: monitor._id, reportEverySec: reportEverySecOf(monitor) },
        'Agent stopped reporting',
      );
      work.push(handleSilence(monitor, now, touch));
    }

    // 2. Agents that are already silent.
    const silent = await Monitor.find({
      type: MONITOR_TYPES.AGENT,
      isPaused: false,
      silenceState: SILENT,
    }).lean();
    for (const monitor of silent) {
      // Went silent in step 1 of this very run: its first failure/probes are under way.
      if (handled.has(String(monitor._id))) continue;
      // Same optimistic claim on lastProbeAt: one worker per monitor per run.
      const claimFilter = {
        _id: monitor._id,
        silenceState: SILENT,
        lastProbeAt: monitor.lastProbeAt,
      };
      if (!monitor.probeUrl) {
        if (monitor.status === MONITOR_STATUS.DOWN) continue; // incident already open
        const claim = await Monitor.updateOne(claimFilter, { $set: { lastProbeAt: now } });
        if (claim.modifiedCount !== 1) continue;
        counts.failures += 1;
        work.push(recordSilenceFailure(monitor, now));
        continue;
      }
      const lastProbe = monitor.lastProbeAt ? new Date(monitor.lastProbeAt).getTime() : 0;
      if (monitor.status !== MONITOR_STATUS.DEGRADED) continue;
      if (now - lastProbe < reprobeEverySec * 1000) continue;
      const claim = await Monitor.updateOne(claimFilter, {
        $set: { silenceState: PROBING, lastProbeAt: now },
      });
      if (claim.modifiedCount !== 1) continue;
      counts.reprobed += 1;
      work.push(handleSilence(monitor, now, touch, SILENT));
    }

    // Monitors are handled in parallel: each probe sequence mostly waits.
    const results = await Promise.allSettled(work);
    for (const failed of results.filter((r) => r.status === 'rejected')) {
      logger.error({ err: failed.reason }, 'Agent silence handling failed');
    }
    if (counts.silenced || counts.reprobed || counts.failures) {
      logger.info(counts, 'Agent silence detector ran');
    }
    return counts;
  };
}
