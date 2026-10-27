import { describe, expect, it } from 'vitest';
import {
  byTypeSentence,
  costValue,
  monitorTypeLabel,
  monthOptions,
  nextSort,
  sortUsageRows,
  usageBudget,
  usageInterval,
} from './usage.js';

const row = (overrides) => ({
  id: overrides.name,
  type: 'http',
  status: 'up',
  intervalLabelSec: 60,
  adaptive: false,
  requests: 0,
  costPer1kRequests: null,
  currency: 'INR',
  actualCost: null,
  estimatedMonthlyCost: null,
  budget: { monthlyRequestBudget: null, usedRatio: null, state: 'none' },
  ...overrides,
});

describe('month options', () => {
  it('lists the current month first, then previous ones across a year boundary', () => {
    expect(monthOptions(new Date('2026-02-10T00:00:00Z'), 4)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
});

describe('interval column', () => {
  it('labels each monitor type', () => {
    expect(usageInterval(row({ name: 'a' }))).toEqual({ label: 'every 1m', markers: [] });
    expect(usageInterval(row({ name: 'h', type: 'heartbeat', intervalLabelSec: 3600 })).label).toBe(
      'ping every 1h',
    );
    expect(usageInterval(row({ name: 'g', type: 'agent', intervalLabelSec: 30 })).label).toBe(
      'report every 30s',
    );
  });

  it('marks adaptive, slowed and budget-paused http monitors in text', () => {
    expect(usageInterval(row({ name: 'a', adaptive: true, intervalLabelSec: 240 }))).toEqual({
      label: 'every 4m',
      markers: ['adaptive'],
    });
    const exceeded = { monthlyRequestBudget: 100, usedRatio: 1.2, state: 'exceeded' };
    expect(
      usageInterval(row({ name: 's', adaptive: true, intervalLabelSec: 900, budget: exceeded }))
        .markers,
    ).toEqual(['slowed']);
    expect(usageInterval(row({ name: 'p', status: 'paused', budget: exceeded })).markers).toEqual([
      'paused (budget)',
    ]);
  });

  it('prefers the API flags over the budget state', () => {
    const exceeded = { monthlyRequestBudget: 100, usedRatio: 1.2, state: 'exceeded' };
    // A past month over budget: not slowed now.
    expect(
      usageInterval(row({ name: 'a', adaptive: true, budget: exceeded, slowedByBudget: false }))
        .markers,
    ).toEqual(['adaptive']);
    expect(
      usageInterval(row({ name: 'b', slowedByBudget: true, budget: exceeded })).markers,
    ).toEqual(['slowed']);
    expect(
      usageInterval(
        row({ name: 'c', status: 'paused', paused: true, pausedReason: 'manual', adaptive: true }),
      ).markers,
    ).toEqual([]);
  });
});

describe('budget and cost', () => {
  it('has no budget bar without a budget', () => {
    expect(usageBudget(row({ name: 'a' }))).toBeNull();
  });

  it('summarises a budget with percent and state', () => {
    const summary = usageBudget(
      row({
        name: 'a',
        requests: 850,
        budget: { monthlyRequestBudget: 1000, usedRatio: 0.85, state: 'warning' },
      }),
    );
    expect(summary).toMatchObject({ used: 850, budget: 1000, percent: 85, state: 'warning' });
  });

  it('uses the estimate this month and the actual cost for past months', () => {
    const priced = row({
      name: 'a',
      costPer1kRequests: 0.5,
      actualCost: 2,
      estimatedMonthlyCost: 21.6,
    });
    expect(costValue(priced, true)).toBe(21.6);
    expect(costValue(priced, false)).toBe(2);
    expect(costValue(row({ name: 'b' }), true)).toBeNull();
  });
});

describe('sorting', () => {
  const rows = [
    row({ name: 'Beta', requests: 10, costPer1kRequests: 1, estimatedMonthlyCost: 5 }),
    row({ name: 'Alpha', requests: 300 }),
    row({ name: 'Gamma', requests: 10, costPer1kRequests: 1, estimatedMonthlyCost: 50 }),
  ];
  const names = (sorted) => sorted.map((r) => r.name);

  it('sorts by requests with name as the tie-breaker', () => {
    expect(names(sortUsageRows(rows, { key: 'requests', direction: 'desc' }))).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(names(sortUsageRows(rows, { key: 'requests', direction: 'asc' }))).toEqual([
      'Beta',
      'Gamma',
      'Alpha',
    ]);
  });

  it('sorts by cost and keeps unpriced monitors last in both directions', () => {
    const opts = { key: 'cost', isCurrentMonth: true };
    expect(names(sortUsageRows(rows, { ...opts, direction: 'desc' }))).toEqual([
      'Gamma',
      'Beta',
      'Alpha',
    ]);
    expect(names(sortUsageRows(rows, { ...opts, direction: 'asc' }))).toEqual([
      'Beta',
      'Gamma',
      'Alpha',
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    sortUsageRows(rows, { key: 'name', direction: 'asc' });
    expect(rows).toEqual(copy);
  });

  it('flips direction on the same column and starts a new one descending', () => {
    expect(nextSort({ key: 'requests', direction: 'desc' }, 'requests')).toEqual({
      key: 'requests',
      direction: 'asc',
    });
    expect(nextSort({ key: 'requests', direction: 'asc' }, 'cost')).toEqual({
      key: 'cost',
      direction: 'desc',
    });
    expect(nextSort({ key: 'cost', direction: 'desc' }, 'name').direction).toBe('asc');
  });
});

describe('labels', () => {
  it('names types and counts them', () => {
    expect(monitorTypeLabel('agent')).toBe('App agent');
    expect(byTypeSentence({ http: 4, heartbeat: 1, agent: 0 })).toBe(
      '4 websites / APIs, 1 heartbeat',
    );
    expect(byTypeSentence({})).toBe('');
  });
});
