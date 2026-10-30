import * as constants from '@pulseboard/shared/constants';
import { formatCount, formatDuration } from './format.js';

// Shared constants from U2; local fallbacks keep the client working if an
// older shared package is installed (values match docs/upgrade/U2-contract.md).
export const BUDGET_SLOW_INTERVAL_SEC = constants.BUDGET_SLOW_INTERVAL_SEC ?? 900;
export const BUDGET_WARNING_RATIO = constants.BUDGET_WARNING_RATIO ?? 0.8;
export const DEFAULT_MAX_INTERVAL_SEC = 600;

const thisMonth = (now = new Date()) => new Date(now).toISOString().slice(0, 7);

/** True when the monitor is slowed (not paused) by its budget this month. */
export function isSlowedByBudget(monitor, now) {
  return (
    !monitor.isPaused &&
    monitor.budgetExceededMonth != null &&
    monitor.budgetExceededMonth === thisMonth(now)
  );
}

/** True when the monitor is paused because its monthly budget ran out. */
export const isPausedByBudget = (monitor) =>
  Boolean(monitor.isPaused && monitor.pausedReason === 'budget_exceeded');

/**
 * True when an administrator paused the monitor (only they can start it again). The API
 * reports it as `pausedBy: 'admin'`; `pausedReason: 'admin'` is the older spelling.
 */
export const isPausedByAdmin = (monitor) =>
  Boolean(monitor.isPaused && (monitor.pausedBy === 'admin' || monitor.pausedReason === 'admin'));

/** The interval the monitor is actually checked at right now. */
export const effectiveIntervalSec = (monitor) => monitor.currentIntervalSec ?? monitor.intervalSec;

/**
 * Compact label for dashboard cards: "4m · adaptive", "15m · slowed", "1m".
 */
export function intervalLabel(monitor, now) {
  const base = formatDuration(effectiveIntervalSec(monitor));
  if (isSlowedByBudget(monitor, now)) return `${base} · slowed`;
  if (monitor.adaptive) return `${base} · adaptive`;
  return base;
}

/**
 * Sentence for the monitor page, e.g.
 * "every 4m (adaptive, base 1m, 30s–10m)" or "every 15m (slowed: budget reached)".
 */
export function intervalDescription(monitor, now) {
  const every = `every ${formatDuration(effectiveIntervalSec(monitor))}`;
  if (isSlowedByBudget(monitor, now)) return `${every} (slowed: budget reached)`;
  if (!monitor.adaptive) return every;
  const range =
    monitor.minIntervalSec != null && monitor.maxIntervalSec != null
      ? `, ${formatDuration(monitor.minIntervalSec)}–${formatDuration(monitor.maxIntervalSec)}`
      : '';
  return `${every} (adaptive, base ${formatDuration(monitor.intervalSec)}${range})`;
}

/** First day of the month after "YYYY-MM", formatted "1 Nov". */
export function nextMonthLabel(month) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index, 1)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * When a monthly estimate exceeds the budget: the day of a 30-day month on
 * which the budget would run out (1-based), else null.
 */
export function budgetRunsOutOnDay(estimatedMonthly, budget) {
  if (!budget || !estimatedMonthly || estimatedMonthly <= budget) return null;
  return Math.max(1, Math.floor((budget / estimatedMonthly) * 30) + 1);
}

/** Form hint comparing the estimate with the budget, or null when it fits. */
export function budgetHint(estimatedMonthly, budget, budgetAction) {
  const day = budgetRunsOutOnDay(estimatedMonthly, budget);
  if (!day) return null;
  const then =
    budgetAction === 'pause'
      ? 'checks pause'
      : `checks slow down to every ${formatDuration(BUDGET_SLOW_INTERVAL_SEC)}`;
  return `≈ ${formatCount(estimatedMonthly)} requests/month is above the budget of ${formatCount(
    budget,
  )}: ${then} around day ${day} of the month.`;
}

/**
 * Budget state for banners/bars from the usage endpoint's `budget` object.
 * Returns null when no budget is set.
 */
export function budgetSummary(usage) {
  const budget = usage?.budget;
  if (!budget?.monthlyRequestBudget) return null;
  const ratio = budget.usedRatio ?? (usage.requests ?? 0) / budget.monthlyRequestBudget;
  const percent = Math.round(ratio * 100);
  const state =
    budget.state ?? (ratio >= 1 ? 'exceeded' : ratio >= BUDGET_WARNING_RATIO ? 'warning' : 'ok');
  return {
    used: usage.requests ?? 0,
    budget: budget.monthlyRequestBudget,
    action: budget.budgetAction ?? 'slow',
    ratio,
    percent,
    state,
    exceeded: Boolean(budget.exceededThisMonth) || state === 'exceeded',
  };
}
