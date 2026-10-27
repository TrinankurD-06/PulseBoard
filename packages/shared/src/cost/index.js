// Cost estimator: how many requests a monitor sends to the customer's
// endpoint, and what that costs at the customer's own price. Pure and
// browser-safe, so the form can show the estimate live as you type.
import { MONITOR_TYPES, POLLING_BASELINE_MONTHLY_REQUESTS } from '../constants.js';

// A "month" for estimates is 30 days, so 1 check per minute = 43,200 requests.
export const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

/** "2026-10" for a date, in UTC: the key of MonitorUsage documents. */
export const monthKey = (date = new Date()) => new Date(date).toISOString().slice(0, 7);

/** Start of the UTC calendar month containing `date`. */
export function monthStart(date = new Date()) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Requests per second this monitor sends to the customer: http checks, or an
 * agent monitor's optional external check (probe-on-silence requests are rare
 * and not estimated). Heartbeats send nothing.
 */
function requestRate(monitor) {
  const type = monitor.type ?? MONITOR_TYPES.HTTP;
  if (type === MONITOR_TYPES.AGENT) {
    const everySec = Number(monitor.externalCheckEverySec);
    if (!monitor.probeUrl || !Number.isFinite(everySec) || everySec <= 0) return 0;
    return 1 / everySec;
  }
  if (type !== MONITOR_TYPES.HTTP) return 0;
  const intervalSec = Number(monitor.intervalSec);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return 0;
  // With adaptive intervals the real interval only grows from the base one
  // after successes, so the base interval gives an upper bound.
  return 1 / intervalSec;
}

/** Estimated requests in a 30-day month. */
export function estimateMonthlyRequests(monitor) {
  return Math.round(requestRate(monitor) * SECONDS_PER_MONTH);
}

/**
 * Requests a month saved compared with polling the endpoint every minute
 * (43,200 in 30 days), never negative. Push monitors save almost all of them.
 */
export function estimateRequestsSaved(monitor) {
  return Math.max(0, POLLING_BASELINE_MONTHLY_REQUESTS - estimateMonthlyRequests(monitor));
}

/** Estimated requests between two dates (e.g. "so far this month"). */
export function estimateRequestsBetween(monitor, from, to) {
  const seconds = Math.max(0, (new Date(to) - new Date(from)) / 1000);
  return Math.round(requestRate(monitor) * seconds);
}

/** Cost of `requests` at the monitor's price, or null when no price is set. */
export function costOf(monitor, requests) {
  const price = monitor.costPer1kRequests;
  if (price == null || price === '' || !Number.isFinite(Number(price))) return null;
  return Math.round((requests / 1000) * Number(price) * 100) / 100;
}

/** Estimated monthly cost, or null when no price is set. */
export function estimateMonthlyCost(monitor) {
  return costOf(monitor, estimateMonthlyRequests(monitor));
}
