import { describe, expect, it } from 'vitest';
import {
  budgetSlowIntervalSec,
  budgetState,
  effectiveIntervalSec,
  isBudgetSlowed,
  nextInterval,
  updateResponseEwma,
} from '../src/adaptive/index.js';

const NOW = new Date('2026-10-15T12:00:00Z');
const base = {
  adaptive: true,
  intervalSec: 60,
  minIntervalSec: 30,
  maxIntervalSec: 600,
  currentIntervalSec: 120,
  status: 'up',
  consecutiveSuccesses: 3,
  responseEwmaMs: 100,
  budgetAction: 'slow',
  budgetExceededMonth: null,
};
const ok = { ok: true, totalMs: 110 };
const fail = { ok: false, totalMs: 4 };

describe('nextInterval', () => {
  it('keeps the base interval when adaptive is off (existing monitors)', () => {
    expect(nextInterval({ ...base, adaptive: false }, fail, NOW)).toBe(60);
    expect(nextInterval({ ...base, adaptive: false, consecutiveSuccesses: 10 }, ok, NOW)).toBe(60);
  });

  it('drops to the fastest interval on any failure', () => {
    expect(nextInterval({ ...base, currentIntervalSec: 600 }, fail, NOW)).toBe(30);
  });

  it('stays at the fastest interval while down, even on a success', () => {
    expect(nextInterval({ ...base, status: 'down', currentIntervalSec: 30 }, ok, NOW)).toBe(30);
  });

  it('doubles on every 10th success in a row while up, capped at the slowest', () => {
    expect(nextInterval({ ...base, consecutiveSuccesses: 10 }, ok, NOW)).toBe(240);
    expect(
      nextInterval({ ...base, consecutiveSuccesses: 20, currentIntervalSec: 240 }, ok, NOW),
    ).toBe(480);
    expect(
      nextInterval({ ...base, consecutiveSuccesses: 30, currentIntervalSec: 480 }, ok, NOW),
    ).toBe(600);
    expect(
      nextInterval({ ...base, consecutiveSuccesses: 40, currentIntervalSec: 600 }, ok, NOW),
    ).toBe(600);
  });

  it('keeps the current interval between doublings', () => {
    expect(nextInterval({ ...base, consecutiveSuccesses: 9 }, ok, NOW)).toBe(120);
    expect(nextInterval({ ...base, consecutiveSuccesses: 11 }, ok, NOW)).toBe(120);
  });

  it('does not double while pending (not yet confirmed up)', () => {
    expect(nextInterval({ ...base, status: 'pending', consecutiveSuccesses: 10 }, ok, NOW)).toBe(
      120,
    );
  });

  it('a response slower than 2x the average pulls a backed-off interval back to the base', () => {
    expect(
      nextInterval({ ...base, currentIntervalSec: 480 }, { ok: true, totalMs: 201 }, NOW),
    ).toBe(60);
    // ...but never slows down a monitor that is already faster than the base.
    expect(nextInterval({ ...base, currentIntervalSec: 30 }, { ok: true, totalMs: 500 }, NOW)).toBe(
      30,
    );
    // No average yet: no spike rule.
    expect(nextInterval({ ...base, responseEwmaMs: null }, { ok: true, totalMs: 9999 }, NOW)).toBe(
      120,
    );
  });

  it('a spike outranks a doubling', () => {
    expect(
      nextInterval(
        { ...base, currentIntervalSec: 480, consecutiveSuccesses: 10 },
        { ok: true, totalMs: 300 },
        NOW,
      ),
    ).toBe(60);
  });

  it('budget slow-down overrides everything, adaptive or not, for this month only', () => {
    const slowed = { ...base, budgetExceededMonth: '2026-10' };
    expect(nextInterval(slowed, fail, NOW)).toBe(900);
    expect(nextInterval({ ...slowed, adaptive: false }, ok, NOW)).toBe(900);
    expect(nextInterval({ ...slowed, budgetExceededMonth: '2026-09' }, fail, NOW)).toBe(30);
    expect(nextInterval({ ...slowed, budgetAction: 'pause' }, fail, NOW)).toBe(30);
  });
});

describe('helpers', () => {
  it('effectiveIntervalSec falls back to the base interval', () => {
    expect(effectiveIntervalSec({ intervalSec: 60, currentIntervalSec: null })).toBe(60);
    expect(effectiveIntervalSec({ intervalSec: 60, currentIntervalSec: 240 })).toBe(240);
  });

  it('budgetSlowIntervalSec is 15 min, or slower if maxIntervalSec is', () => {
    expect(budgetSlowIntervalSec({ maxIntervalSec: 600 })).toBe(900);
    expect(budgetSlowIntervalSec({ maxIntervalSec: 3600 })).toBe(3600);
  });

  it('isBudgetSlowed only for the slow action in the exceeded month', () => {
    expect(isBudgetSlowed({ budgetAction: 'slow', budgetExceededMonth: '2026-10' }, NOW)).toBe(
      true,
    );
    expect(isBudgetSlowed({ budgetAction: 'pause', budgetExceededMonth: '2026-10' }, NOW)).toBe(
      false,
    );
    expect(isBudgetSlowed({ budgetAction: 'slow', budgetExceededMonth: null }, NOW)).toBe(false);
  });
});

describe('updateResponseEwma', () => {
  const t0 = new Date('2026-10-15T00:00:00Z');
  const after = (ms) => new Date(t0.getTime() + ms);

  it('starts from the first sample', () => {
    expect(updateResponseEwma(null, null, 120, t0)).toBe(120);
  });

  it('moves a little after a short gap and a lot after a long one', () => {
    const minute = updateResponseEwma(100, t0, 200, after(60_000));
    const day = updateResponseEwma(100, t0, 200, after(24 * 3_600_000));
    expect(minute).toBeGreaterThan(100);
    expect(minute).toBeLessThan(101);
    expect(day).toBeCloseTo(163.2, 0); // 1 - e^-1 of the way
  });
});

describe('budgetState', () => {
  it('classifies usage against the budget', () => {
    expect(budgetState(500, null)).toBe('none');
    expect(budgetState(79, 100)).toBe('ok');
    expect(budgetState(80, 100)).toBe('warning');
    expect(budgetState(99, 100)).toBe('warning');
    expect(budgetState(100, 100)).toBe('exceeded');
    expect(budgetState(150, 100)).toBe('exceeded');
  });
});
