// Node-only budget helpers (use models). The pure maths is in ../adaptive.
import { MONITOR_STATUS, PAUSED_REASONS } from '../constants.js';
import { Monitor } from '../models/Monitor.js';

/**
 * Removes an active budget restriction (budget-pause or budget-slow) from a
 * monitor and puts it back on its normal schedule. Used by the monthly reset
 * job and when a member raises the budget.
 *
 * - paused by budget  -> resumed (pending, counters reset), job rescheduled
 * - slowed by budget  -> interval back to the base, job rescheduled
 * - paused by a user  -> the budget marker is cleared, but it stays paused
 *
 * The update is guarded on the month that was exceeded, so two callers
 * racing (e.g. two workers running the reset) lift it only once.
 * Returns true if this call lifted a restriction.
 */
export async function liftBudgetRestriction(monitorId, scheduler) {
  const monitor = await Monitor.findOne(
    { _id: monitorId, budgetExceededMonth: { $ne: null } },
    { budgetExceededMonth: 1, isPaused: 1, pausedReason: 1, intervalSec: 1 },
  ).lean();
  if (!monitor) return false;

  const pausedByBudget = monitor.isPaused && monitor.pausedReason === PAUSED_REASONS.BUDGET;
  const lifted = await Monitor.findOneAndUpdate(
    { _id: monitor._id, budgetExceededMonth: monitor.budgetExceededMonth },
    {
      $set: {
        budgetExceededMonth: null,
        currentIntervalSec: monitor.intervalSec,
        ...(pausedByBudget && {
          isPaused: false,
          pausedReason: null,
          status: MONITOR_STATUS.PENDING,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        }),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!lifted) return false;

  if (!lifted.isPaused) await scheduler.scheduleMonitor(lifted);
  return true;
}
