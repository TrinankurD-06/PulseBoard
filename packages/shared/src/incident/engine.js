// The incident engine, shared by the worker (scheduled checks, overdue
// heartbeats) and the API (heartbeat pings). Node-only (uses models).
import { ALERT_KIND, JOB_NAMES, MONITOR_TYPES } from '../constants.js';
import { AlertChannel, Monitor } from '../models/index.js';
import {
  decideTransition,
  thresholdsFor,
  TRANSITION_TARGET,
  transitionGuards,
  TRANSITIONS,
} from './stateMachine.js';
import { openIncident, resolveOpenIncident } from './store.js';

/**
 * Atomic counter update as an aggregation-pipeline update: the new counters,
 * the streak start time and the latest-check fields are all computed by
 * MongoDB in ONE write, from the document's current values. Two checks of the
 * same monitor finishing at once therefore both get counted, with no
 * read-modify-write race.
 *
 * Every value that came from the outside world is wrapped in $literal, so a
 * string such as "$foo" in an error message is never read as a field path.
 */
export function buildCheckUpdate(result, checkedAt) {
  const literal = (value) => ({ $literal: value ?? null });
  const latest = {
    lastCheckedAt: literal(checkedAt),
    lastResponseMs: literal(result.totalMs),
    lastOk: literal(result.ok),
    lastStatusCode: literal(result.statusCode),
    lastError: literal(result.error),
    lastTimings: literal(result.timings),
    sslExpiresAt: result.sslExpiresAt ? literal(result.sslExpiresAt) : '$sslExpiresAt',
  };

  const streak = result.ok
    ? {
        consecutiveSuccesses: { $add: ['$consecutiveSuccesses', 1] },
        consecutiveFailures: 0,
        recoveringSince: {
          $cond: [{ $eq: ['$consecutiveSuccesses', 0] }, literal(checkedAt), '$recoveringSince'],
        },
      }
    : {
        consecutiveFailures: { $add: ['$consecutiveFailures', 1] },
        consecutiveSuccesses: 0,
        failingSince: {
          $cond: [{ $eq: ['$consecutiveFailures', 0] }, literal(checkedAt), '$failingSince'],
        },
        failingCause: {
          $cond: [{ $eq: ['$consecutiveFailures', 0] }, literal(result.error), '$failingCause'],
        },
        failingCauseCode: {
          $cond: [
            { $eq: ['$consecutiveFailures', 0] },
            literal(result.errorCode),
            '$failingCauseCode',
          ],
        },
      };

  return [{ $set: { ...latest, ...streak } }];
}

/** Timeline text for an opened incident, worded for the monitor's type. */
function openedMessage(monitor, cause) {
  if (monitor.type === MONITOR_TYPES.HEARTBEAT) return `Heartbeat missing or failed: ${cause}`;
  const { failure } = thresholdsFor(monitor.type);
  if (monitor.type === MONITOR_TYPES.AGENT) {
    return `Down after ${failure} consecutive failed reports or probes: ${cause}`;
  }
  return `Down after ${failure} consecutive failed checks: ${cause}`;
}

function recoveredMessage(monitor) {
  if (monitor.type === MONITOR_TYPES.HEARTBEAT) return 'Recovered: pings are arriving again';
  if (monitor.type === MONITOR_TYPES.AGENT) return 'Recovered: agent reports are healthy again';
  return 'Recovered: checks are passing again';
}

/**
 * Turns check results into monitor status changes, incidents and alerts.
 *
 * 1. Count the check atomically (buildCheckUpdate) and read the new counters.
 * 2. Ask the pure state machine whether a transition is due, with the
 *    thresholds of the monitor's type (http 3/2, heartbeat 1/1).
 * 3. Apply it with a *guarded* update: the filter repeats the transition's
 *    precondition (e.g. "not already down AND failures >= 3"). If two
 *    processes race, only one update matches; the loser sees null and does
 *    nothing. So one outage = one incident = one round of alerts.
 *
 * `agenda` only needs `now(name, data)` to queue send-alert jobs, so the API's
 * never-started Agenda instance works too.
 */
export function createIncidentEngine({ agenda, logger }) {
  async function scheduleAlerts(incident, kind) {
    const channels = await AlertChannel.find(
      { workspaceId: incident.workspaceId, isEnabled: true },
      { _id: 1 },
    ).lean();
    await Promise.all(
      channels.map((channel) =>
        agenda.now(JOB_NAMES.SEND_ALERT, {
          incidentId: String(incident._id),
          channelId: String(channel._id),
          kind,
          attempt: 1,
        }),
      ),
    );
    return channels.length;
  }

  async function onIncidentOpened(monitor, checkedAt) {
    const cause = monitor.failingCause ?? monitor.lastError ?? 'Unknown';
    const incident = await openIncident(monitor, {
      startedAt: monitor.failingSince ?? checkedAt,
      openedAt: checkedAt,
      cause,
      code: monitor.failingCauseCode ?? null,
      message: openedMessage(monitor, cause),
    });
    if (!incident) return; // already open (safety net: unique index)
    const alerts = await scheduleAlerts(incident, ALERT_KIND.DOWN);
    logger.warn({ monitorId: monitor._id, incidentId: incident._id, alerts }, 'Incident opened');
  }

  async function onIncidentResolved(monitor, checkedAt) {
    const incident = await resolveOpenIncident(monitor._id, {
      // The outage ended at the first good check, not when recovery was confirmed.
      resolvedAt: monitor.recoveringSince ?? checkedAt,
      at: checkedAt,
      message: recoveredMessage(monitor),
    });
    if (!incident) return;
    const alerts = await scheduleAlerts(incident, ALERT_KIND.UP);
    logger.info(
      {
        monitorId: monitor._id,
        incidentId: incident._id,
        durationSec: incident.durationSec,
        alerts,
      },
      'Incident resolved',
    );
  }

  /**
   * Records one check result. Returns { transition, monitor }: the transition
   * applied (if any) and the monitor document as counted, so the caller can
   * compute the next adaptive interval without reading it again.
   */
  return async function processCheckResult(monitorId, result, checkedAt) {
    const counted = await Monitor.collection.findOneAndUpdate(
      { _id: monitorId, isPaused: false },
      buildCheckUpdate(result, checkedAt),
      { returnDocument: 'after' },
    );
    if (!counted) return { transition: null, monitor: null }; // paused or deleted meanwhile

    const thresholds = thresholdsFor(counted.type);
    const transition = decideTransition(counted, thresholds);
    if (!transition) return { transition: null, monitor: counted };

    const moved = await Monitor.collection.findOneAndUpdate(
      { _id: monitorId, ...transitionGuards(thresholds)[transition] },
      { $set: { status: TRANSITION_TARGET[transition] } },
      { returnDocument: 'after' },
    );
    // Another process applied it first: report no transition, but the counted state.
    if (!moved) return { transition: null, monitor: counted };

    if (transition === TRANSITIONS.OPEN_INCIDENT) await onIncidentOpened(moved, checkedAt);
    if (transition === TRANSITIONS.RESOLVE_INCIDENT) await onIncidentResolved(moved, checkedAt);
    return { transition, monitor: moved };
  };
}
