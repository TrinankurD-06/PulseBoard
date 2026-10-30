import { describe, expect, it } from 'vitest';
import {
  budgetHint,
  budgetRunsOutOnDay,
  budgetSummary,
  intervalDescription,
  intervalLabel,
  isPausedByAdmin,
  isPausedByBudget,
  isSlowedByBudget,
  nextMonthLabel,
} from './budget.js';

const now = new Date('2026-10-15T12:00:00Z');
const base = { intervalSec: 60, currentIntervalSec: 60, adaptive: false, isPaused: false };

describe('interval labels', () => {
  it('shows the plain interval for non-adaptive monitors', () => {
    expect(intervalLabel(base, now)).toBe('1m');
    expect(intervalDescription(base, now)).toBe('every 1m');
  });

  it('shows the current interval and the adaptive range', () => {
    const monitor = {
      ...base,
      adaptive: true,
      currentIntervalSec: 240,
      minIntervalSec: 30,
      maxIntervalSec: 600,
    };
    expect(intervalLabel(monitor, now)).toBe('4m · adaptive');
    expect(intervalDescription(monitor, now)).toBe('every 4m (adaptive, base 1m, 30s–10m)');
  });

  it('falls back to intervalSec when currentIntervalSec is missing', () => {
    expect(intervalLabel({ ...base, currentIntervalSec: null, intervalSec: 30 }, now)).toBe('30s');
  });

  it('marks a monitor slowed by its budget this month only', () => {
    const slowed = {
      ...base,
      adaptive: true,
      currentIntervalSec: 900,
      budgetExceededMonth: '2026-10',
    };
    expect(isSlowedByBudget(slowed, now)).toBe(true);
    expect(intervalLabel(slowed, now)).toBe('15m · slowed');
    expect(intervalDescription(slowed, now)).toBe('every 15m (slowed: budget reached)');
    expect(isSlowedByBudget({ ...slowed, budgetExceededMonth: '2026-09' }, now)).toBe(false);
    expect(isSlowedByBudget({ ...slowed, isPaused: true }, now)).toBe(false);
  });

  it('recognises a budget pause', () => {
    expect(isPausedByBudget({ isPaused: true, pausedReason: 'budget_exceeded' })).toBe(true);
    expect(isPausedByBudget({ isPaused: true, pausedReason: 'user' })).toBe(false);
  });
});

describe('budget helpers', () => {
  it('nextMonthLabel gives the 1st of the following month', () => {
    expect(nextMonthLabel('2026-10')).toBe('1 Nov');
    expect(nextMonthLabel('2026-12')).toBe('1 Jan');
  });

  it('budgetRunsOutOnDay', () => {
    expect(budgetRunsOutOnDay(43_200, 20_000)).toBe(14);
    expect(budgetRunsOutOnDay(43_200, 50_000)).toBeNull();
    expect(budgetRunsOutOnDay(43_200, null)).toBeNull();
  });

  it('budgetHint explains what happens and when', () => {
    expect(budgetHint(43_200, 20_000, 'slow')).toBe(
      '≈ 43,200 requests/month is above the budget of 20,000: checks slow down to every 15m around day 14 of the month.',
    );
    expect(budgetHint(43_200, 20_000, 'pause')).toMatch(/checks pause around day 14/);
    expect(budgetHint(10_000, 20_000, 'slow')).toBeNull();
  });

  it('budgetSummary reads the usage endpoint payload', () => {
    expect(budgetSummary({ requests: 10, budget: null })).toBeNull();
    expect(
      budgetSummary({
        requests: 16_400,
        budget: {
          monthlyRequestBudget: 20_000,
          budgetAction: 'slow',
          usedRatio: 0.82,
          state: 'warning',
          exceededThisMonth: false,
        },
      }),
    ).toEqual({
      used: 16_400,
      budget: 20_000,
      action: 'slow',
      ratio: 0.82,
      percent: 82,
      state: 'warning',
      exceeded: false,
    });
  });

  it('budgetSummary derives the state when the server does not send it', () => {
    const summary = budgetSummary({ requests: 21_000, budget: { monthlyRequestBudget: 20_000 } });
    expect(summary).toMatchObject({ state: 'exceeded', exceeded: true, percent: 105 });
  });
});

describe('isPausedByAdmin', () => {
  it('reads pausedBy, and the older pausedReason', () => {
    expect(isPausedByAdmin({ isPaused: true, pausedBy: 'admin' })).toBe(true);
    expect(isPausedByAdmin({ isPaused: true, pausedReason: 'admin' })).toBe(true);
  });

  it('is false for the owner, the budget, or a monitor that is running', () => {
    expect(isPausedByAdmin({ isPaused: true, pausedBy: 'user' })).toBe(false);
    expect(isPausedByAdmin({ isPaused: true, pausedBy: 'budget' })).toBe(false);
    expect(isPausedByAdmin({ isPaused: false, pausedBy: 'admin' })).toBe(false);
    expect(isPausedByAdmin({ isPaused: true })).toBe(false);
  });
});
