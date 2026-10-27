import { setTimeout as delay } from 'node:timers/promises';
import { probeTargetOf, silentSinceOf } from '@pulseboard/shared/agent';
import { runHttpCheck } from '@pulseboard/shared/check';
import {
  AGENT_PROBE_COUNT,
  AGENT_PROBE_SPACING_MS,
  AGENT_SILENCE_STATE,
  CHECK_SOURCES,
  JOB_NAMES,
  MONITOR_STATUS,
  NOTICE_KIND,
} from '@pulseboard/shared/constants';
import { AlertChannel, CheckResult, Monitor } from '@pulseboard/shared/models';
import { recordUsage } from '@pulseboard/shared/usage';

const { DOWN, PAUSED, DEGRADED } = MONITOR_STATUS;

/**
 * Probe-on-silence for agent monitors (U4), used by the silence detector and
 * by the external check: cheap HEAD requests to the monitor's probeUrl with
 * the normal check runner, each one a real check result (source 'probe'),
 * counted as usage and fed to the incident engine.
 *
 * spacingMs / sleep are injectable so tests don't wait 10 s between probes.
 */
export function createAgentProber({
  allowPrivate,
  appUrl,
  agenda,
  processCheckResult,
  logger,
  spacingMs = AGENT_PROBE_SPACING_MS,
  sleep = delay,
}) {
  async function probeOnce(monitor, source = CHECK_SOURCES.PROBE) {
    const result = await runHttpCheck(probeTargetOf(monitor), { allowPrivate, appUrl });
    const checkedAt = new Date();
    await recordUsage(monitor, result.requestsSent, checkedAt);
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
      source,
    });
    return { result, checkedAt };
  }

  /**
   * Up to AGENT_PROBE_COUNT probes, spacingMs apart, stopping at the first
   * success. Runs only while the monitor stays in 'probing': a report arriving
   * meanwhile (or a pause) ends it. All failing = 3 failures for the engine,
   * which opens the incident. `touch` keeps the Agenda job's lock alive.
   *
   * Returns 'reachable', 'unreachable' or 'aborted'.
   */
  async function confirm(monitorId, { touch } = {}) {
    for (let attempt = 0; attempt < AGENT_PROBE_COUNT; attempt += 1) {
      if (attempt > 0) {
        await sleep(spacingMs);
        await touch?.();
      }
      const monitor = await Monitor.findOne({
        _id: monitorId,
        isPaused: false,
        silenceState: AGENT_SILENCE_STATE.PROBING,
      }).lean();
      if (!monitor) return 'aborted';
      const { result, checkedAt } = await probeOnce(monitor);
      await processCheckResult(monitor._id, result, checkedAt);
      if (result.ok) return 'reachable';
    }
    return 'unreachable';
  }

  async function queueNotice(monitor, details) {
    const channels = await AlertChannel.find(
      { workspaceId: monitor.workspaceId, isEnabled: true },
      { _id: 1 },
    ).lean();
    await Promise.all(
      channels.map((channel) =>
        agenda.now(JOB_NAMES.SEND_NOTICE, {
          monitorId: String(monitor._id),
          channelId: String(channel._id),
          noticeKind: NOTICE_KIND.AGENT_SILENT,
          details,
          attempt: 1,
        }),
      ),
    );
    return channels.length;
  }

  /**
   * The agent is silent but its endpoint answers: status 'degraded' (unless an
   * incident is open), and the "agent silent" notice once per silence (the
   * silentNoticeAt marker is claimed atomically, so two workers send one).
   */
  async function markReachable(monitorId, now = new Date()) {
    await Monitor.updateOne(
      { _id: monitorId, isPaused: false, status: { $nin: [DOWN, PAUSED] } },
      { $set: { status: DEGRADED } },
    );
    const claimed = await Monitor.findOneAndUpdate(
      { _id: monitorId, status: DEGRADED, silentNoticeAt: null },
      { $set: { silentNoticeAt: now } },
      { returnDocument: 'after' },
    ).lean();
    if (!claimed) return;
    const silentSec = Math.round((now - silentSinceOf(claimed)) / 1000);
    const notices = await queueNotice(claimed, { silentSec });
    logger.warn({ monitorId, notices }, 'Agent silent but endpoint reachable: degraded');
  }

  return { probeOnce, confirm, markReachable };
}
