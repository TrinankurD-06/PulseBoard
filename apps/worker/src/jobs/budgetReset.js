import { liftBudgetRestriction } from '@pulseboard/shared/budget';
import { monthKey } from '@pulseboard/shared/cost';
import { Monitor } from '@pulseboard/shared/models';

/**
 * `budget-reset`: runs at 00:00 UTC on the 1st of each month, and once when
 * the worker boots (catch-up if no worker was running at midnight).
 *
 * Every monitor restricted by a PREVIOUS month's budget gets its normal
 * schedule back (budget-paused -> resumed, budget-slowed -> base interval).
 * User-paused monitors stay paused. A restriction from the current month is
 * left alone: that budget really is used up.
 */
export function createBudgetResetJob({ scheduler, logger }) {
  return async function budgetResetJob(now = new Date()) {
    const month = monthKey(now);
    const restricted = await Monitor.find(
      { budgetExceededMonth: { $nin: [null, month] } },
      { _id: 1 },
    ).lean();

    let lifted = 0;
    for (const { _id } of restricted) {
      if (await liftBudgetRestriction(_id, scheduler)) lifted += 1;
    }
    if (lifted > 0) logger.info({ lifted, month }, 'Monthly budget reset');
    return lifted;
  };
}
