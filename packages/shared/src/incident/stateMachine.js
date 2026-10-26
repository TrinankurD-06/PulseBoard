// The incident state machine, as pure functions (no I/O), so every
// transition can be unit-tested. The worker applies the same rules to the
// database with conditional updates (see TRANSITION_GUARDS).
//
//   pending --(1st success)------------------> up
//   pending or up --(3 failures in a row)----> down   (open incident, "down" alerts)
//   down --(2 successes in a row)------------> up     (resolve incident, "recovered" alerts)
//
// Anything short of a threshold leaves the status alone, so a single blip, or
// a flapping endpoint that never fails 3 times in a row, opens nothing.
import { FAILURE_THRESHOLD, MONITOR_STATUS, RECOVERY_THRESHOLD } from '../constants.js';

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

/**
 * MongoDB filters that must still match for a transition to be applied. The
 * worker uses them in findOneAndUpdate, so if two checks of the same monitor
 * race, only one of them can move the status, and only one incident opens.
 */
export const TRANSITION_GUARDS = Object.freeze({
  [TRANSITIONS.OPEN_INCIDENT]: {
    status: { $nin: [DOWN, PAUSED] },
    consecutiveFailures: { $gte: FAILURE_THRESHOLD },
  },
  [TRANSITIONS.RESOLVE_INCIDENT]: {
    status: DOWN,
    consecutiveSuccesses: { $gte: RECOVERY_THRESHOLD },
  },
  [TRANSITIONS.MARK_UP]: { status: PENDING, consecutiveSuccesses: { $gte: 1 } },
});

/**
 * Given a monitor's status and its counters *after* the latest check was
 * counted, which transition (if any) should happen?
 */
export function decideTransition({ status, consecutiveFailures, consecutiveSuccesses }) {
  if (status === PAUSED) return null;
  if (status !== DOWN && consecutiveFailures >= FAILURE_THRESHOLD) {
    return TRANSITIONS.OPEN_INCIDENT;
  }
  if (status === DOWN && consecutiveSuccesses >= RECOVERY_THRESHOLD) {
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
export function nextMonitorState(state, ok) {
  if (state.status === PAUSED) return { ...state, transition: null };
  const counters = countCheck(state, ok);
  const transition = decideTransition({ status: state.status, ...counters });
  return {
    ...counters,
    status: transition ? TRANSITION_TARGET[transition] : state.status,
    transition,
  };
}
