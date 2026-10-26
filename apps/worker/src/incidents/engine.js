import { ALERT_KIND, FAILURE_THRESHOLD, JOB_NAMES } from '@pulseboard/shared/constants';
import {
  decideTransition,
  openIncident,
  resolveOpenIncident,
  TRANSITION_GUARDS,
  TRANSITION_TARGET,
  TRANSITIONS,
} from '@pulseboard/shared/incident';
import { AlertChannel, Monitor } from '@pulseboard/shared/models';

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
      };

  return [{ $set: { ...latest, ...streak } }];
}

/**
 * Turns check results into monitor status changes, incidents and alerts.
 *
 * 1. Count the check atomically (buildCheckUpdate) and read the new counters.
 * 2. Ask the pure state machine whether a transition is due.
 * 3. Apply it with a *guarded* update: the filter repeats the transition's
 *    precondition (e.g. "not already down AND failures >= 3"). If two workers
 *    race, only one update matches; the loser sees null and does nothing. So
 *    one outage = one incident = one round of alerts.
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
      message: `Down after ${FAILURE_THRESHOLD} consecutive failed checks: ${cause}`,
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
      message: 'Recovered: checks are passing again',
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

  /** Records one check result; returns the transition applied, if any (for tests/logs). */
  return async function processCheckResult(monitorId, result, checkedAt) {
    const counted = await Monitor.collection.findOneAndUpdate(
      { _id: monitorId, isPaused: false },
      buildCheckUpdate(result, checkedAt),
      { returnDocument: 'after' },
    );
    if (!counted) return null; // paused or deleted meanwhile

    const transition = decideTransition(counted);
    if (!transition) return null;

    const moved = await Monitor.collection.findOneAndUpdate(
      { _id: monitorId, ...TRANSITION_GUARDS[transition] },
      { $set: { status: TRANSITION_TARGET[transition] } },
      { returnDocument: 'after' },
    );
    if (!moved) return null; // another worker applied it first

    if (transition === TRANSITIONS.OPEN_INCIDENT) await onIncidentOpened(moved, checkedAt);
    if (transition === TRANSITIONS.RESOLVE_INCIDENT) await onIncidentResolved(moved, checkedAt);
    return transition;
  };
}
