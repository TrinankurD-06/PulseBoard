import { CHECK_SOURCES, MONITOR_TYPES } from '@pulseboard/shared/constants';
import { CheckResult, Monitor } from '@pulseboard/shared/models';
import { recordPing } from '@pulseboard/shared/usage';
import { notFound } from '../../lib/errors.js';
import { heartbeatDueAt } from '../monitors/monitors.service.js';

export const PING_KINDS = Object.freeze({ SUCCESS: 'success', FAIL: 'fail', START: 'start' });

const DEFAULT_FAILURE_MESSAGE = 'Failure reported by the job';
const MAX_MESSAGE = 500;

/** The job's own failure message, trimmed to something safe to store and show. */
function failureMessage(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? text.slice(0, MAX_MESSAGE) : DEFAULT_FAILURE_MESSAGE;
}

/**
 * Records heartbeat pings. A success or failure ping is a check result like any
 * other: stored in the time-series collection (source 'heartbeat'), so uptime,
 * rollups, status pages and charts work unchanged, and fed to the shared
 * incident engine (heartbeat thresholds: 1 failure opens, 1 success resolves).
 */
export function createPingService({ processCheckResult }) {
  return {
    async record(token, kind, { message } = {}) {
      const monitor =
        typeof token === 'string' && token.length >= 32
          ? await Monitor.findOne({ heartbeatToken: token, type: MONITOR_TYPES.HEARTBEAT }).lean()
          : null;
      if (!monitor) throw notFound('Unknown ping URL');
      if (monitor.isPaused) return { ok: true, ignored: 'paused' };

      const now = new Date();
      if (kind === PING_KINDS.START) {
        await Monitor.updateOne({ _id: monitor._id }, { $set: { lastStartAt: now } });
        return { ok: true };
      }

      const ok = kind === PING_KINDS.SUCCESS;
      // A /start since the previous ping means this ping ends a timed run.
      const startedThisRun =
        monitor.lastStartAt && (!monitor.lastPingAt || monitor.lastStartAt > monitor.lastPingAt);
      const durationMs = startedThisRun ? now - new Date(monitor.lastStartAt) : null;
      const error = ok ? null : failureMessage(message);

      // The job ran (even if it failed), so the next ping is due one period from now.
      await Monitor.updateOne(
        { _id: monitor._id },
        { $set: { lastPingAt: now, nextDueAt: heartbeatDueAt(monitor, now) } },
      );
      await CheckResult.create({
        timestamp: now,
        meta: { monitorId: monitor._id, workspaceId: monitor.workspaceId },
        ok,
        error,
        totalMs: durationMs,
        source: CHECK_SOURCES.HEARTBEAT,
      });
      await recordPing(monitor, now);
      await processCheckResult(
        monitor._id,
        { ok, statusCode: null, error, totalMs: durationMs, timings: null },
        now,
      );
      return { ok: true };
    },
  };
}
