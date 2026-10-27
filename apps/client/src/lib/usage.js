// Pure helpers for the workspace Cost & usage page (GET /workspaces/:wid/usage).
import { budgetSummary } from './budget.js';
import { formatDuration } from './format.js';

export const MONITOR_TYPE_LABELS = {
  http: 'Website / API',
  heartbeat: 'Heartbeat',
  agent: 'App agent',
};

export const monitorTypeLabel = (type) => MONITOR_TYPE_LABELS[type] ?? type;

/** "YYYY-MM" (UTC), like the usage documents. */
export const monthOf = (date = new Date()) => new Date(date).toISOString().slice(0, 7);

/** The current month and the `count - 1` before it, newest first. */
export function monthOptions(now = new Date(), count = 6) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const index = date.getUTCMonth();
  return Array.from({ length: count }, (_, i) => monthOf(new Date(Date.UTC(year, index - i, 1))));
}

/**
 * The interval column: "1m", "every 1h" etc., plus text markers so the state
 * never depends on colour. http: current interval, "adaptive" or "slowed"
 * (budget reached, still checking) / "paused (budget)"; heartbeat: expected
 * ping interval; agent: report window.
 */
export function usageInterval(row) {
  const every = formatDuration(row.intervalLabelSec);
  if (row.type === 'heartbeat') return { label: `ping every ${every}`, markers: [] };
  if (row.type === 'agent') return { label: `report every ${every}`, markers: [] };

  // The API says whether the budget slowed or paused the monitor (this month
  // only); older responses without those fields fall back to the budget state.
  const exceeded = row.budget?.state === 'exceeded';
  const paused = row.paused ?? row.status === 'paused';
  const budgetPaused =
    paused && (row.pausedReason != null ? row.pausedReason === 'budget_exceeded' : exceeded);
  const slowed = row.slowedByBudget ?? (exceeded && !paused);

  const markers = [];
  if (budgetPaused) markers.push('paused (budget)');
  else if (slowed) markers.push('slowed');
  else if (row.adaptive && !paused) markers.push('adaptive');
  return { label: `every ${every}`, markers };
}

/** Budget bar data for one row, or null when the monitor has no budget. */
export const usageBudget = (row) => budgetSummary(row);

/**
 * The money shown and sorted on in the cost column: the monthly estimate for
 * the current month, what was actually spent for a finished month. Null when
 * no price is set.
 */
export function costValue(row, isCurrentMonth) {
  if (row.costPer1kRequests == null) return null;
  return isCurrentMonth ? (row.estimatedMonthlyCost ?? row.actualCost) : row.actualCost;
}

export const SORT_KEYS = ['name', 'requests', 'cost'];

/**
 * Rows sorted by `key` ('name' | 'requests' | 'cost') in `direction`
 * ('asc' | 'desc'). Rows without a price always sort after priced ones; ties
 * keep name order. Costs in different currencies are compared as numbers
 * (they are never converted); the column shows each one's currency.
 */
export function sortUsageRows(rows, { key = 'requests', direction = 'desc', isCurrentMonth }) {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const value = (row) => (key === 'cost' ? costValue(row, isCurrentMonth) : (row[key] ?? 0));

  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b);
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return byName(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    return va === vb ? byName(a, b) : sign * (va - vb);
  });
}

/** Clicking a header: same column flips the direction, a new one starts descending (name: ascending). */
export function nextSort(current, key) {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: key === 'name' ? 'asc' : 'desc' };
}

/** "4 websites, 1 heartbeat, 1 agent" for the page description. */
export function byTypeSentence(byType = {}) {
  const parts = [
    [byType.http, 'website / API', 'websites / APIs'],
    [byType.heartbeat, 'heartbeat', 'heartbeats'],
    [byType.agent, 'app agent', 'app agents'],
  ]
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return parts.join(', ');
}
