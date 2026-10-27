// Pure helpers for check results as the charts and lists show them.
import { OFFLINE_LABEL } from './health.js';

/** A result the checker could not judge (it had no network): never a failure. */
export const isOfflineCheck = (point) => point.state === 'unknown';

/**
 * Rows for the response-time chart: a time-axis value, and the flags the
 * layers need. An offline result has no value (a gap and a band, never a drop
 * to zero); a failed one sits on the baseline and is marked.
 */
export function responseRows(points) {
  return points.map((p) => {
    const offline = isOfflineCheck(p);
    const value = offline ? null : (p.totalMs ?? 0);
    return {
      ...p,
      ts: Date.parse(p.t),
      offline,
      value,
      failedValue: !offline && !p.ok ? value : null,
    };
  });
}

/** One line for a result in a list or table: "Passed", "Failed", "Checker offline", "92% of 12 passed". */
export function resultText(point) {
  if (isOfflineCheck(point)) return OFFLINE_LABEL;
  if (point.count) return `${Math.round((point.upRatio ?? 1) * 100)}% of ${point.count} passed`;
  return point.ok ? 'Passed' : 'Failed';
}

/** The error code to show next to a failed row, or null. */
export function failureCode(point) {
  if (isOfflineCheck(point) || point.ok) return null;
  return point.errorCode ?? null;
}
