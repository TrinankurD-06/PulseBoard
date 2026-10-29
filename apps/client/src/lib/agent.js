// Pure helpers for agent monitors (the customer's app reports to us through
// the pulseboard-agent npm package): form presets and validation, setup
// snippets, live state labels and chart data.
import {
  AGENT_DEFAULT_ERROR_RATE_THRESHOLD,
  AGENT_DEFAULT_REPORT_EVERY_SEC,
  AGENT_SILENCE_PERIODS,
  POLLING_BASELINE_MONTHLY_REQUESTS,
} from '@pulseboard/shared/constants';
import { agentCreateSchema } from '@pulseboard/shared/schemas';
import { z } from 'zod';
import { formatDuration, hostOf, timeAgo } from './format.js';

import { AGENT_TYPE, isAgent } from './monitorType.js';

export { AGENT_TYPE, isAgent };

export const AGENT_PACKAGE = 'pulseboard-agent';
export const KEY_ENV_VAR = 'PULSEBOARD_KEY';

const MONTH_SEC = 30 * 24 * 60 * 60;
const REPORT_PRESETS = [30, 60, 120, 300];
// Off by default; every 15–30 minutes is plenty as a second opinion.
const EXTERNAL_CHECK_PRESETS = [300, 900, 1800, 3600, 6 * 3600, 24 * 3600];
export const SUGGESTED_EXTERNAL_CHECK_SEC = [900, 1800];

/** Preset options, always including the current value so editing never loses it. */
export function reportEveryOptions(current) {
  return withCurrent(REPORT_PRESETS, current);
}

export function externalCheckOptions(current) {
  return withCurrent(EXTERNAL_CHECK_PRESETS, current);
}

function withCurrent(presets, current) {
  const value = Number(current);
  if (current == null || current === '' || !Number.isFinite(value) || presets.includes(value)) {
    return presets;
  }
  return [...presets, value].sort((a, b) => a - b);
}

/**
 * Form schema for an agent monitor: the API's own shared create schema, so
 * client and server rules can't drift. The form has no `type` field; the
 * schema adds it for validation and strips it from the output (the page adds
 * it on create, and PATCH bodies don't take it).
 */
export function buildAgentSchema() {
  return z
    .preprocess((values) => ({ ...values, type: AGENT_TYPE }), agentCreateSchema)
    .transform(({ type: _type, ...values }) => values);
}

export function toAgentFormValues(monitor) {
  const text = (value) => (value == null ? '' : String(value));
  return {
    name: monitor?.name ?? '',
    reportEverySec: String(monitor?.reportEverySec ?? AGENT_DEFAULT_REPORT_EVERY_SEC),
    errorRateThreshold: String(monitor?.errorRateThreshold ?? AGENT_DEFAULT_ERROR_RATE_THRESHOLD),
    p95ThresholdMs: text(monitor?.p95ThresholdMs),
    probeUrl: monitor?.probeUrl ?? '',
    externalCheckEverySec: text(monitor?.externalCheckEverySec),
  };
}

/** Requests PulseBoard itself sends to the customer's servers per month (external checks only). */
export function estimateAgentMonthlyRequests(externalCheckEverySec) {
  const sec = Number(externalCheckEverySec);
  if (!externalCheckEverySec || !Number.isFinite(sec) || sec <= 0) return 0;
  return Math.ceil(MONTH_SEC / sec);
}

/** Requests saved compared with polling every minute (43,200/month), floored at 0. */
export function requestsSavedVsPolling(monthlyRequests) {
  return Math.max(0, POLLING_BASELINE_MONTHLY_REQUESTS - (Number(monthlyRequests) || 0));
}

/** The API base URL the agent reports to. */
export function agentEndpoint(origin = globalThis.window?.location?.origin ?? '') {
  return `${origin}/api/v1`;
}

/** Display form of a key nobody can see anymore: its stored prefix, masked. */
export function maskedKey(prefix) {
  return `${prefix || 'pbk_'}••••••••••••`;
}

/** Copy-paste setup snippets. The key itself only goes in the env snippet. */
export function agentSnippets({ endpoint, reportEverySec, agentKey }) {
  const options = [`    apiKey: process.env.${KEY_ENV_VAR},`, `    endpoint: '${endpoint}',`];
  if (reportEverySec && Number(reportEverySec) !== AGENT_DEFAULT_REPORT_EVERY_SEC) {
    options.push(`    intervalSec: ${Number(reportEverySec)},`);
  }
  return {
    install: `npm install ${AGENT_PACKAGE}`,
    env: `${KEY_ENV_VAR}=${agentKey ?? '<your agent key>'}`,
    code: [
      `import express from 'express';`,
      `import { pulseboard } from '${AGENT_PACKAGE}';`,
      ``,
      `const app = express();`,
      `app.use(`,
      `  pulseboard({`,
      ...options,
      `  }),`,
      `); // before your routes`,
    ].join('\n'),
  };
}

/** "every 1m · agent" for dashboard cards. */
export function agentIntervalLabel(monitor) {
  return `every ${formatDuration(monitor.reportEverySec ?? AGENT_DEFAULT_REPORT_EVERY_SEC)} · agent`;
}

export function lastReportLabel(monitor, now = Date.now()) {
  return monitor.lastReportAt ? timeAgo(monitor.lastReportAt, now) : 'never';
}

/**
 * Where the agent stands right now, as text (colour is only a reinforcement).
 * `state`: 'paused' | 'waiting' (never reported) | 'reporting' | 'late'
 * (overdue, the silence detector hasn't run yet) | 'probing' | 'degraded'
 * (silent but the probe URL answers) | 'silent'.
 */
export function agentState(monitor, now = Date.now()) {
  if (monitor.isPaused) return { state: 'paused', text: 'Paused: reports are ignored' };
  const probeHost = monitor.probeUrl ? hostOf(monitor.probeUrl) : null;
  const since = monitor.lastReportAt ? timeAgo(monitor.lastReportAt, now) : null;
  const lastText = since ? `last report ${since}` : 'no report yet';

  if (monitor.status === 'degraded') {
    return {
      state: 'degraded',
      text: `Agent stopped reporting (${lastText}), but ${probeHost ?? 'the app'} still answers`,
    };
  }
  if (monitor.silenceState === 'probing') {
    return {
      state: 'probing',
      text: probeHost
        ? `No report (${lastText}): checking ${probeHost}…`
        : `No report (${lastText}): confirming the outage…`,
    };
  }
  if (monitor.silenceState === 'silent') {
    return { state: 'silent', text: `Agent silent: ${lastText}` };
  }
  if (!monitor.lastReportAt) {
    return { state: 'waiting', text: 'Waiting for the first report…' };
  }
  const periodMs = (monitor.reportEverySec ?? AGENT_DEFAULT_REPORT_EVERY_SEC) * 1000;
  if (now - new Date(monitor.lastReportAt).getTime() > AGENT_SILENCE_PERIODS * periodMs) {
    return { state: 'late', text: `Report overdue: ${lastText}` };
  }
  return { state: 'reporting', text: `Reporting: ${lastText}` };
}

/** "3d 4h" from an agent's process uptime in seconds. */
export function formatUptime(uptimeSec) {
  if (uptimeSec == null) return '—';
  return formatDuration(uptimeSec < 60 ? uptimeSec : Math.floor(uptimeSec / 60) * 60);
}

const round1 = (value) => Math.round(value * 10) / 10;

/** Typical spacing of the points in seconds (median gap; robust to silence gaps). */
function typicalGapSec(points, fallbackSec) {
  const gaps = [];
  for (let i = 1; i < points.length; i += 1) {
    const gap = (new Date(points[i].t) - new Date(points[i - 1].t)) / 1000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return fallbackSec;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Chart rows from GET agent-metrics points. Request rate is per minute (each
 * point covers one report window, or one downsampled bucket); the error rate
 * is computed here as 5xx / requests in percent, exactly like the server's
 * threshold check, and is null for a window without traffic.
 */
export function metricsSeries(points = [], reportEverySec = AGENT_DEFAULT_REPORT_EVERY_SEC) {
  const windowMin = typicalGapSec(points, reportEverySec) / 60;
  return points.map((p) => ({
    t: p.t,
    requests: p.requests ?? 0,
    perMinute: round1((p.requests ?? 0) / windowMin),
    errors5xx: p.errors5xx ?? 0,
    errors4xx: p.errors4xx ?? 0,
    errorRate: p.requests > 0 ? round1(((p.errors5xx ?? 0) / p.requests) * 100) : null,
    p50Ms: p.p50Ms ?? null,
    p95Ms: p.p95Ms ?? null,
    p99Ms: p.p99Ms ?? null,
  }));
}

/** Totals over the visible range, for chart descriptions. */
export function metricsSummary(rows) {
  const requests = rows.reduce((sum, r) => sum + r.requests, 0);
  const errors5xx = rows.reduce((sum, r) => sum + r.errors5xx, 0);
  return {
    requests,
    errors5xx,
    errorRate: requests > 0 ? round1((errors5xx / requests) * 100) : null,
  };
}

export const formatPercent = (value) => (value == null ? '—' : `${value}%`);
