// Agent monitors (U4): pure, browser-safe helpers shared by the API (report
// endpoint), the worker (silence detector) and the client.
import {
  AGENT_DEFAULT_ERROR_RATE_THRESHOLD,
  AGENT_DEFAULT_REPORT_EVERY_SEC,
  DEFAULT_EXPECTED_STATUS,
  DEFAULT_TIMEOUT_MS,
} from '../constants.js';

const round1 = (value) => Math.round(value * 10) / 10;

/** Share of requests that failed with 5xx, in percent (null without traffic). */
export function errorRateOf({ requests, errors5xx }) {
  return requests > 0 ? (errors5xx / requests) * 100 : null;
}

/**
 * Decides whether one agent report counts as a successful or a failed check:
 *   - error rate (5xx / requests) above the monitor's errorRateThreshold % -> failure
 *   - p95 latency above p95ThresholdMs (when set)                         -> failure
 *   - otherwise success. Zero traffic is a success: the report itself
 *     proves the app is alive.
 * Returns { ok, error } where error describes every breached threshold.
 */
export function evaluateAgentReport(report, monitor) {
  const problems = [];
  const threshold = monitor.errorRateThreshold ?? AGENT_DEFAULT_ERROR_RATE_THRESHOLD;
  const errorRate = errorRateOf(report);
  if (errorRate != null && errorRate > threshold) {
    problems.push(`Error rate ${round1(errorRate)} % above ${threshold} %`);
  }
  const p95Limit = monitor.p95ThresholdMs;
  if (p95Limit != null && report.p95Ms != null && report.p95Ms > p95Limit) {
    problems.push(`p95 ${round1(report.p95Ms)} ms above ${p95Limit} ms`);
  }
  return problems.length ? { ok: false, error: problems.join('; ') } : { ok: true, error: null };
}

/**
 * Since when the agent has been silent: its last report, or when watching
 * (re)started (creation, resume; older documents: createdAt), whichever is later.
 */
export function silentSinceOf(monitor) {
  const times = [monitor.lastReportAt, monitor.watchSince ?? monitor.createdAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return new Date(Math.max(...times));
}

/** Same as silentSinceOf, as a MongoDB aggregation expression ($max skips nulls). */
export const SILENT_SINCE_EXPR = Object.freeze({
  $max: ['$lastReportAt', { $ifNull: ['$watchSince', '$createdAt'] }],
});

/**
 * The check target for probes, the external check and "Test now" of an agent
 * monitor: a cheap HEAD request to probeUrl with the default timeout and
 * expected statuses (GET when the server is known to reject HEAD).
 */
export function probeTargetOf(monitor) {
  return {
    url: monitor.probeUrl,
    method: 'HEAD',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    expectedStatus: { ...DEFAULT_EXPECTED_STATUS },
    keyword: null,
    headUnsupported: Boolean(monitor.headUnsupported),
  };
}

/** Report period of a monitor (older documents / defaults). */
export const reportEverySecOf = (monitor) =>
  monitor.reportEverySec ?? AGENT_DEFAULT_REPORT_EVERY_SEC;
