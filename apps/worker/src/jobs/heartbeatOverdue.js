import { humanDuration } from '@pulseboard/shared/alerts';
import {
  CHECK_SOURCES,
  HEARTBEAT_MAX_MISSED_PER_RUN,
  MISSED_PING_PREFIX,
  MONITOR_TYPES,
} from '@pulseboard/shared/constants';
import { CheckResult, Monitor } from '@pulseboard/shared/models';

/** Why a missed period counts as a failure, shown in the UI and alerts. */
export function missedPingMessage(monitor) {
  return `${MISSED_PING_PREFIX} ${humanDuration(monitor.expectedEverySec)} + ${humanDuration(
    monitor.graceSec,
  )} grace`;
}

/**
 * Handler for the `heartbeat-overdue` job (every 30 s): turns missing pings
 * into failed checks.
 *
 * For every active heartbeat whose `nextDueAt` has passed, each missed period
 * is CLAIMED with a conditional update ("advance nextDueAt by one period, only
 * if it is still what I read"). Only one process can win a given period, so
 * even two detectors running at once record exactly one failure per missed
 * period: uptime % then means "share of expected pings that arrived".
 *
 * The failure is timestamped at the moment the period became overdue (not
 * when the detector noticed), so incidents start at the right time. A long
 * outage is caught up at most HEARTBEAT_MAX_MISSED_PER_RUN periods per run.
 */
export function createHeartbeatOverdueJob({ processCheckResult, logger }) {
  async function processMonitor(monitor, now) {
    let dueAt = monitor.nextDueAt;
    let missed = 0;
    while (dueAt <= now && missed < HEARTBEAT_MAX_MISSED_PER_RUN) {
      const nextDueAt = new Date(dueAt.getTime() + monitor.expectedEverySec * 1000);
      const claimed = await Monitor.updateOne(
        { _id: monitor._id, isPaused: false, nextDueAt: dueAt },
        { $set: { nextDueAt } },
      );
      if (claimed.modifiedCount === 0) break; // another detector (or a ping) got there first

      const error = missedPingMessage(monitor);
      await CheckResult.create({
        timestamp: dueAt,
        meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
        ok: false,
        error,
        source: CHECK_SOURCES.HEARTBEAT,
      });
      await processCheckResult(
        monitor._id,
        { ok: false, statusCode: null, error, totalMs: null, timings: null },
        dueAt,
      );
      missed += 1;
      dueAt = nextDueAt;
    }
    return missed;
  }

  return async function heartbeatOverdueJob(now = new Date()) {
    const overdue = await Monitor.find(
      { type: MONITOR_TYPES.HEARTBEAT, isPaused: false, nextDueAt: { $lte: now } },
      { workspaceId: 1, expectedEverySec: 1, graceSec: 1, nextDueAt: 1 },
    ).lean();

    let missed = 0;
    for (const monitor of overdue) missed += await processMonitor(monitor, now);
    if (missed) logger.info({ monitors: overdue.length, missed }, 'Recorded missed heartbeats');
    return missed;
  };
}
