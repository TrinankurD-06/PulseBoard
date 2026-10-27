import { evaluateAgentReport } from '@pulseboard/shared/agent';
import {
  AGENT_SILENCE_STATE,
  CHECK_SOURCES,
  MONITOR_STATUS,
  MONITOR_TYPES,
} from '@pulseboard/shared/constants';
import { AgentReport, CheckResult, Monitor } from '@pulseboard/shared/models';
import { recordReport } from '@pulseboard/shared/usage';
import { unauthorized } from '../../lib/errors.js';
import { hashAgentKey } from './agentKey.js';

// An agent whose clock is off by more than this gets its window moved to our
// clock, so charts and the 7-day expiry stay right.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The report's window, shifted to the server clock when the agent's clock is off. */
function windowOf(report, now) {
  const skew = now - report.windowEnd;
  if (Math.abs(skew) <= MAX_CLOCK_SKEW_MS) return [report.windowStart, report.windowEnd];
  return [new Date(report.windowStart.getTime() + skew), now];
}

/**
 * Records agent reports. Each report is one check result (source 'agent'):
 * evaluated against the monitor's thresholds (evaluateAgentReport), stored,
 * and fed to the shared incident engine (thresholds 3/2). It also proves the
 * agent is alive, so it ends any silence (and a 'degraded' status).
 */
export function createAgentService({ processCheckResult }) {
  return {
    /** The active agent monitor for a key, or 401. Only the hash is compared. */
    async authenticate(key) {
      const monitor = key
        ? await Monitor.findOne({
            agentKeyHash: hashAgentKey(key),
            type: MONITOR_TYPES.AGENT,
          }).lean()
        : null;
      if (!monitor) throw unauthorized('Invalid agent key');
      return monitor;
    },

    async record(monitor, report) {
      if (monitor.isPaused) return { ok: true, ignored: 'paused' };
      const now = new Date();
      const [windowStart, windowEnd] = windowOf(report, now);
      const { ok, error } = evaluateAgentReport(report, monitor);
      const meta = { monitorId: monitor._id, workspaceId: monitor.workspaceId };

      // Alive again: back to 'reporting', and degraded -> up in the same write.
      await Monitor.collection.updateOne({ _id: monitor._id, isPaused: false }, [
        {
          $set: {
            lastReportAt: { $literal: now },
            silenceState: AGENT_SILENCE_STATE.REPORTING,
            silentNoticeAt: null,
            lastProbeAt: null,
            status: {
              $cond: [{ $eq: ['$status', MONITOR_STATUS.DEGRADED] }, MONITOR_STATUS.UP, '$status'],
            },
          },
        },
      ]);
      await Promise.all([
        AgentReport.create({ ...report, windowStart, windowEnd, meta }),
        CheckResult.create({
          timestamp: now,
          meta,
          ok,
          error,
          totalMs: report.p50Ms,
          source: CHECK_SOURCES.AGENT,
        }),
        recordReport(monitor, now),
      ]);
      await processCheckResult(
        monitor._id,
        { ok, statusCode: null, error, totalMs: report.p50Ms, timings: null },
        now,
      );
      return { ok: true };
    },
  };
}
