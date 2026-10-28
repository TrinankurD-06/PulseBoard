import { budgetSlowIntervalSec, budgetState } from '@pulseboard/shared/adaptive';
import {
  JOB_NAMES,
  MONITOR_STATUS,
  NOTICE_KIND,
  PAUSED_REASONS,
} from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import { resolveOpenIncident } from '@pulseboard/shared/incident';
import { openPause } from '@pulseboard/shared/pauses';
import { AlertChannel, Monitor } from '@pulseboard/shared/models';
import { applyIntervalToRunningJob } from '@pulseboard/shared/scheduling';
import { claimUsageMarker } from '@pulseboard/shared/usage';

/**
 * Enforces a monitor's monthly request budget after each check.
 *
 *   >= 80 %  -> one "budget_warning" notice per month
 *   >= 100 % -> one "budget_exceeded" notice, and the budget action:
 *               pause: monitor paused (reason budget_exceeded), job removed,
 *                      open incident closed without a recovery alert
 *               slow:  interval set to the slow interval for the rest of the month
 *
 * "Once per month" is guaranteed by atomic markers on MonitorUsage (warnedAt,
 * exceededAt): only the caller that flips a marker from null acts, so two
 * workers crossing the threshold together still send one notice.
 */
export function createBudgetEnforcer({ agenda, db, scheduler, logger }) {
  async function queueNotice(monitor, noticeKind, details) {
    const channels = await AlertChannel.find(
      { workspaceId: monitor.workspaceId, isEnabled: true },
      { _id: 1 },
    ).lean();
    await Promise.all(
      channels.map((channel) =>
        agenda.now(JOB_NAMES.SEND_NOTICE, {
          monitorId: String(monitor._id),
          channelId: String(channel._id),
          noticeKind,
          details,
          attempt: 1,
        }),
      ),
    );
  }

  async function applyAction(job, monitor, month, at) {
    if (monitor.budgetAction === 'pause') {
      const paused = await Monitor.findOneAndUpdate(
        { _id: monitor._id, isPaused: false },
        {
          $set: {
            isPaused: true,
            status: MONITOR_STATUS.PAUSED,
            pausedReason: PAUSED_REASONS.BUDGET,
            budgetExceededMonth: month,
          },
        },
      ).lean();
      if (!paused) return;
      await openPause(monitor._id, at);
      // Removing the job from inside its own run is safe: Agenda ignores the
      // failed post-run save of a job that no longer exists.
      await scheduler.cancelMonitor(monitor._id);
      await resolveOpenIncident(monitor._id, {
        resolvedAt: at,
        message: 'Closed because monitoring was paused (monthly request budget reached)',
      });
      return;
    }

    const slowSec = budgetSlowIntervalSec(monitor);
    await Monitor.updateOne(
      { _id: monitor._id },
      { $set: { budgetExceededMonth: month, currentIntervalSec: slowSec } },
    );
    if (!(await applyIntervalToRunningJob(job, db, slowSec))) {
      logger.warn({ monitorId: monitor._id }, 'Check job not found to slow it down');
    }
  }

  /** `requests` is this month's total after the latest check. */
  return async function enforceBudget({ job, monitor, requests, at = new Date() }) {
    const budget = monitor.monthlyRequestBudget;
    const state = budgetState(requests, budget);
    if (state === 'none' || state === 'ok') return state;

    const month = monthKey(at);
    const details = {
      requests,
      budget,
      month,
      budgetAction: monitor.budgetAction,
      slowIntervalSec: budgetSlowIntervalSec(monitor),
    };

    // Claim the warning marker even when jumping straight past 100 %, so a
    // late "80 %" notice can't follow the "100 %" one.
    const warnClaimed = await claimUsageMarker(monitor._id, month, 'warnedAt', at);
    if (state === 'warning') {
      if (warnClaimed) await queueNotice(monitor, NOTICE_KIND.BUDGET_WARNING, details);
      return state;
    }

    if (await claimUsageMarker(monitor._id, month, 'exceededAt', at)) {
      await applyAction(job, monitor, month, at);
      await queueNotice(monitor, NOTICE_KIND.BUDGET_EXCEEDED, details);
      logger.warn(
        { monitorId: monitor._id, requests, budget, action: monitor.budgetAction },
        'Monthly request budget reached',
      );
    }
    return state;
  };
}
