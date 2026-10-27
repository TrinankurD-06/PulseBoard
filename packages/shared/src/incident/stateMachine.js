// The incident state machine, as pure functions (no I/O), so every
// transition can be unit-tested. The incident engine applies the same rules
// to the database with conditional updates (see transitionGuards).
//
//   pending --(1st success)------------------> up
//   pending or up --(N failures in a row)----> down   (open incident, "down" alerts)
//   down --(M successes in a row)------------> up     (resolve incident, "recovered" alerts)
//
// N/M depend on the monitor type (thresholdsFor): 3/2 for http and agent
// monitors, 1/1 for heartbeats. Anything short of a threshold leaves the status
// alone, so a single blip, or a flapping endpoint that never fails 3 times in a
// row, opens nothing.
import {
  FAILURE_THRESHOLD,
  HEARTBEAT_FAILURE_THRESHOLD,
  HEARTBEAT_RECOVERY_THRESHOLD,
  MONITOR_STATUS,
  MONITOR_TYPES,
  RECOVERY_THRESHOLD,
} from '../constants.js';

const { UP, DOWN, PENDING, PAUSED } = MONITOR_STATUS;

export const TRANSITIONS = Object.freeze({
  OPEN_INCIDENT: 'open_incident', // -> down, open an incident, send "down" alerts
  RESOLVE_INCIDENT: 'resolve_incident', // -> up, resolve the incident, send "recovered" alerts
  MARK_UP: 'mark_up', // pending -> up (first success; no incident involved)
});

/** Status each transition moves the monitor to. */
export const TRANSITION_TARGET = Object.freeze({
  [TRANSITIONS.OPEN_INCIDENT]: DOWN,
  [TRANSITIONS.RESOLVE_INCIDENT]: UP,
  [TRANSITIONS.MARK_UP]: UP,
});

const HTTP_THRESHOLDS = Object.freeze({ failure: FAILURE_THRESHOLD, recovery: RECOVERY_THRESHOLD });
const HEARTBEAT_THRESHOLDS = Object.freeze({
  failure: HEARTBEAT_FAILURE_THRESHOLD,
  recovery: HEARTBEAT_RECOVERY_THRESHOLD,
});

/** Failures to open / successes to resolve an incident, per monitor type (missing = http). */
export function thresholdsFor(type) {
  return type === MONITOR_TYPES.HEARTBEAT ? HEARTBEAT_THRESHOLDS : HTTP_THRESHOLDS;
}

/**
 * MongoDB filters that must still match for a transition to be applied. The
 * engine uses them in findOneAndUpdate, so if two checks of the same monitor
 * race, only one of them can move the status, and only one incident opens.
 */
export function transitionGuards({ failure, recovery }) {
  return {
    [TRANSITIONS.OPEN_INCIDENT]: {
      status: { $nin: [DOWN, PAUSED] },
      consecutiveFailures: { $gte: failure },
    },
    [TRANSITIONS.RESOLVE_INCIDENT]: {
      status: DOWN,
      consecutiveSuccesses: { $gte: recovery },
    },
    [TRANSITIONS.MARK_UP]: { status: PENDING, consecutiveSuccesses: { $gte: 1 } },
  };
}

/** The guards for http monitors (kept for backwards compatibility). */
export const TRANSITION_GUARDS = Object.freeze(transitionGuards(HTTP_THRESHOLDS));

/**
 * Given a monitor's status and its counters *after* the latest check was
 * counted, which transition (if any) should happen? Thresholds default to the
 * monitor's type (state.type; missing = http).
 */
export function decideTransition(
  { status, consecutiveFailures, consecutiveSuccesses, type },
  thresholds = thresholdsFor(type),
) {
  if (status === PAUSED) return null;
  if (status !== DOWN && consecutiveFailures >= thresholds.failure) {
    return TRANSITIONS.OPEN_INCIDENT;
  }
  if (status === DOWN && consecutiveSuccesses >= thresholds.recovery) {
    return TRANSITIONS.RESOLVE_INCIDENT;
  }
  if (status === PENDING && consecutiveSuccesses >= 1) return TRANSITIONS.MARK_UP;
  return null;
}

/** Counters after one check: a success resets failures and vice versa. */
export function countCheck(state, ok) {
  return ok
    ? { consecutiveFailures: 0, consecutiveSuccesses: state.consecutiveSuccesses + 1 }
    : { consecutiveFailures: state.consecutiveFailures + 1, consecutiveSuccesses: 0 };
}

/**
 * Full step of the state machine: previous state + check outcome -> next
 * state and the transition that happened (or null).
 */
export function nextMonitorState(state, ok, thresholds = thresholdsFor(state.type)) {
  if (state.status === PAUSED) return { ...state, transition: null };
  const counters = countCheck(state, ok);
  const transition = decideTransition({ status: state.status, ...counters }, thresholds);
  return {
    ...counters,
    status: transition ? TRANSITION_TARGET[transition] : state.status,
    transition,
  };
}
