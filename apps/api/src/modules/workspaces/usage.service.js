import { budgetState, effectiveIntervalSec, isBudgetSlowed } from '@pulseboard/shared/adaptive';
import { DEFAULT_CURRENCY, MONITOR_TYPES } from '@pulseboard/shared/constants';
import {
  costOf,
  estimateMonthlyCost,
  estimateMonthlyRequests,
  estimateRequestsSaved,
  monthKey,
} from '@pulseboard/shared/cost';
import { Monitor, MonitorUsage } from '@pulseboard/shared/models';

const round2 = (value) => Math.round(value * 100) / 100;

/** The interval shown in the table: how often we check, or how often the monitor reports in. */
function intervalLabelSec(monitor) {
  const type = monitor.type ?? MONITOR_TYPES.HTTP;
  if (type === MONITOR_TYPES.HEARTBEAT) return monitor.expectedEverySec ?? null;
  if (type === MONITOR_TYPES.AGENT) return monitor.reportEverySec ?? null;
  return effectiveIntervalSec(monitor);
}

function toRow(monitor, usage, month, now) {
  const type = monitor.type ?? MONITOR_TYPES.HTTP;
  const isHttp = type === MONITOR_TYPES.HTTP;
  const requests = usage?.requests ?? 0;
  // A paused monitor sends nothing, so it neither costs nor "saves" anything.
  const paused = Boolean(monitor.isPaused);
  const estimatedMonthlyRequests = paused ? 0 : estimateMonthlyRequests(monitor);
  const estimatedMonthlyCost = paused ? costOf(monitor, 0) : estimateMonthlyCost(monitor);
  const budget = monitor.monthlyRequestBudget ?? null;

  return {
    id: String(monitor._id),
    name: monitor.name,
    type,
    status: monitor.status,
    paused,
    pausedReason: monitor.pausedReason ?? null,
    intervalLabelSec: intervalLabelSec(monitor),
    adaptive: isHttp && Boolean(monitor.adaptive),
    baseIntervalSec: isHttp ? monitor.intervalSec : null,
    currentIntervalSec: isHttp ? effectiveIntervalSec(monitor) : null,
    slowedByBudget: isHttp && isBudgetSlowed(monitor, now) && month === monthKey(now),
    requests,
    estimatedMonthlyRequests,
    requestsSaved: paused ? 0 : estimateRequestsSaved(monitor),
    pings: usage?.pings ?? 0,
    reports: usage?.reports ?? 0,
    costPer1kRequests: monitor.costPer1kRequests ?? null,
    // lean() skips schema defaults, so a not-yet-migrated monitor may lack it.
    currency: monitor.currency ?? DEFAULT_CURRENCY,
    actualCost: costOf(monitor, requests),
    estimatedMonthlyCost,
    budget: {
      monthlyRequestBudget: budget,
      budgetAction: monitor.budgetAction ?? 'slow',
      usedRatio: budget ? Math.round((requests / budget) * 1000) / 1000 : null,
      state: budgetState(requests, budget),
    },
  };
}

/** Sums costs per currency (never converted), only over monitors that have a price. */
function costByCurrency(rows) {
  const byCurrency = new Map();
  for (const row of rows) {
    if (row.costPer1kRequests == null) continue;
    const entry = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      actual: 0,
      estimatedMonthly: 0,
    };
    entry.actual += row.actualCost ?? 0;
    entry.estimatedMonthly += row.estimatedMonthlyCost ?? 0;
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.values()]
    .map((entry) => ({
      ...entry,
      actual: round2(entry.actual),
      estimatedMonthly: round2(entry.estimatedMonthly),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * The workspace Cost & Usage page: one row per monitor with what it sent (or
 * received) in `month`, plus totals. Two queries whatever the monitor count:
 * the month's usage documents and the monitors. Totals are the sum of the rows,
 * so a deleted monitor's usage isn't counted (its row is gone too).
 * Estimates and budgets describe the monitor as configured now, also for past months.
 */
export async function getWorkspaceUsage(workspaceId, month, now = new Date()) {
  const [usages, monitors] = await Promise.all([
    MonitorUsage.find(
      { workspaceId, month },
      { monitorId: 1, requests: 1, pings: 1, reports: 1 },
    ).lean(),
    Monitor.find({ workspaceId }).sort({ name: 1 }).lean(),
  ]);
  const usageByMonitor = new Map(usages.map((usage) => [String(usage.monitorId), usage]));
  const rows = monitors.map((monitor) =>
    toRow(monitor, usageByMonitor.get(String(monitor._id)), month, now),
  );

  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  const byType = Object.fromEntries(Object.values(MONITOR_TYPES).map((type) => [type, 0]));
  for (const row of rows) byType[row.type] = (byType[row.type] ?? 0) + 1;

  return {
    month,
    totals: {
      monitors: rows.length,
      byType,
      requests: sum('requests'),
      estimatedMonthlyRequests: sum('estimatedMonthlyRequests'),
      requestsSaved: sum('requestsSaved'),
      pings: sum('pings'),
      reports: sum('reports'),
      costByCurrency: costByCurrency(rows),
    },
    monitors: rows,
  };
}
