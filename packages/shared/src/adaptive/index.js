// Adaptive intervals and budget maths (U2), as pure functions. Browser-safe:
// the worker uses them to schedule checks, the client to explain them.
import {
  ADAPTIVE_SUCCESS_RUN,
  BUDGET_SLOW_INTERVAL_SEC,
  BUDGET_WARNING_RATIO,
  MONITOR_STATUS,
} from '../constants.js';
import { monthKey } from '../cost/index.js';

const EWMA_TIME_CONSTANT_MS = 24 * 60 * 60 * 1000;

/** The interval the check job actually uses. */
export const effectiveIntervalSec = (monitor) => monitor.currentIntervalSec ?? monitor.intervalSec;

/** Interval while "slowed" by an exhausted budget: 15 min, or slower if maxIntervalSec is. */
export const budgetSlowIntervalSec = (monitor) =>
  Math.max(BUDGET_SLOW_INTERVAL_SEC, monitor.maxIntervalSec ?? 0);

/** True while the monitor is slowed down because this month's budget ran out. */
export function isBudgetSlowed(monitor, now = new Date()) {
  return monitor.budgetAction === 'slow' && monitor.budgetExceededMonth === monthKey(now);
}

/**
 * The interval to use after a check. `monitor` is the state AFTER the incident
 * engine counted the check (status and consecutiveSuccesses already updated).
 *
 * Order matters:
 *   1. budget-slowed this month -> the slow interval (overrides everything)
 *   2. not adaptive             -> the base interval (unchanged behaviour)
 *   3. the check failed         -> fastest, to confirm an outage quickly
 *   4. still down               -> fastest
 *   5. response > 2x average    -> pull a backed-off interval back to the base
 *   6. every 10th success in a row while up -> double, capped at maxIntervalSec
 *   7. otherwise                -> keep the current interval
 */
export function nextInterval(monitor, lastResult, now = new Date()) {
  const base = monitor.intervalSec;
  const current = effectiveIntervalSec(monitor);

  if (isBudgetSlowed(monitor, now)) return budgetSlowIntervalSec(monitor);
  if (!monitor.adaptive) return base;
  if (!lastResult.ok) return monitor.minIntervalSec;
  if (monitor.status === MONITOR_STATUS.DOWN) return monitor.minIntervalSec;

  const average = monitor.responseEwmaMs;
  if (average != null && average > 0 && lastResult.totalMs > 2 * average) {
    return Math.min(current, base);
  }

  const successes = monitor.consecutiveSuccesses ?? 0;
  if (
    monitor.status === MONITOR_STATUS.UP &&
    successes > 0 &&
    successes % ADAPTIVE_SUCCESS_RUN === 0
  ) {
    return Math.min(current * 2, monitor.maxIntervalSec);
  }
  return current;
}

/**
 * Time-weighted exponential moving average with a 24 h time constant: a
 * sample's weight depends on how much time passed since the last one, so the
 * result approximates "the last 24 hours" whatever the check interval is.
 */
export function updateResponseEwma(prevMs, prevAt, sampleMs, at = new Date()) {
  if (prevMs == null || prevAt == null) return sampleMs;
  const elapsed = Math.max(0, new Date(at) - new Date(prevAt));
  const weight = 1 - Math.exp(-elapsed / EWMA_TIME_CONSTANT_MS);
  return Math.round((prevMs + weight * (sampleMs - prevMs)) * 10) / 10;
}

/** 'none' (no budget) | 'ok' | 'warning' (>= 80%) | 'exceeded' (>= 100%). */
export function budgetState(requests, budget) {
  if (budget == null || !(budget > 0)) return 'none';
  if (requests >= budget) return 'exceeded';
  if (requests >= budget * BUDGET_WARNING_RATIO) return 'warning';
  return 'ok';
}
