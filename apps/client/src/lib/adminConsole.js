// Pure helpers for the platform admin console: query strings, readable action names,
// typed-confirmation matching, status/tone mapping and pagination text. No React, so
// each is tested on its own (adminConsole.test.js).
import { formatCurrency, formatDuration } from './format.js';
import { statusStyle } from './status.js';

/** The console's own navigation (the workspace nav is not shown here). */
export const ADMIN_NAV = [
  { to: '/app/admin', label: 'Overview', end: true },
  { to: '/app/admin/users', label: 'Users' },
  { to: '/app/admin/workspaces', label: 'Workspaces' },
  { to: '/app/admin/monitors', label: 'Monitors' },
  { to: '/app/admin/incidents', label: 'Incidents' },
  { to: '/app/admin/system', label: 'System' },
  { to: '/app/admin/audit', label: 'Audit log' },
];

export const DEFAULT_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Query strings

const isBlank = (value) =>
  value === undefined || value === null || value === '' || value === false || Number.isNaN(value);

/**
 * The params worth sending: blank values (empty search, an unticked toggle, no filter)
 * are dropped, `true` is sent as "true", everything else as given.
 */
export function cleanParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (isBlank(value)) continue;
    out[key] = value === true ? 'true' : typeof value === 'string' ? value.trim() : value;
    if (out[key] === '') delete out[key];
  }
  return out;
}

/** "a=1&b=2" (no leading "?") from filter state; blank values are left out. */
export function buildQuery(params = {}) {
  return new URLSearchParams(
    Object.entries(cleanParams(params)).map(([key, value]) => [key, String(value)]),
  ).toString();
}

/** A page number from the URL: a whole number >= 1, else 1. */
export function parsePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

/**
 * Date inputs ("YYYY-MM-DD") to the ISO instants the audit endpoint filters on:
 * `from` is the start of that day, `to` the end of it (both UTC). Bad input is dropped.
 */
export function dateRangeParams({ from, to } = {}) {
  const valid = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') && !Number.isNaN(Date.parse(day));
  return {
    from: valid(from) ? `${from}T00:00:00.000Z` : undefined,
    to: valid(to) ? `${to}T23:59:59.999Z` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Typed confirmation

/** True only when `typed` equals `required` exactly (case-sensitive, no trimming). */
export function typedConfirmMatches(typed, required) {
  return typeof required === 'string' && required.length > 0 && typed === required;
}

// ---------------------------------------------------------------------------
// Pagination

export function pageCount(total, limit = DEFAULT_PAGE_SIZE) {
  return Math.max(1, Math.ceil((total ?? 0) / limit));
}

/** "Showing 26–50 of 132", or "No results". */
export function paginationText({ page = 1, limit = DEFAULT_PAGE_SIZE, total = 0 } = {}) {
  if (!total) return 'No results';
  const first = (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  if (first > total) return `No results on page ${page} (${total} in all)`;
  return `Showing ${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
}

// ---------------------------------------------------------------------------
// Audit log: readable action names

const ACTION_LABELS = {
  'user.read': 'Viewed a user',
  'user.suspend': 'Suspended a user',
  'user.unsuspend': 'Unsuspended a user',
  'user.revoke_sessions': "Revoked a user's sessions",
  'user.delete': 'Deleted a user',
  'workspace.read': 'Viewed a workspace',
  'workspace.view': 'Viewed a workspace as an administrator',
  'workspace.transfer': 'Transferred a workspace',
  'workspace.suspend': 'Suspended a workspace',
  'workspace.unsuspend': 'Unsuspended a workspace',
  'workspace.delete': 'Deleted a workspace',
  'monitor.read': 'Viewed a monitor',
  'monitor.pause': 'Paused a monitor',
  'monitor.resume': 'Resumed a monitor',
  'monitor.test': 'Tested a monitor',
  'monitor.delete': 'Deleted a monitor',
  'monitor.bulk': 'Ran a bulk action on monitors',
  'incident.read': 'Viewed an incident',
};

/** Action codes the audit filter offers, in the order above. */
export const AUDIT_ACTIONS = Object.keys(ACTION_LABELS);

export const TARGET_TYPES = ['user', 'workspace', 'monitor', 'incident'];

const TARGET_LABELS = {
  user: 'User',
  workspace: 'Workspace',
  monitor: 'Monitor',
  incident: 'Incident',
};

export const targetTypeLabel = (type) => TARGET_LABELS[type] ?? humanize(type);

function humanize(code) {
  const text = String(code ?? '')
    .replace(/[._]+/g, ' ')
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown action';
}

/** "Suspended a user" for `user.suspend`; an unknown code is spelled out, never hidden. */
export const actionLabel = (action) => ACTION_LABELS[action] ?? humanize(action);

const shown = (value) =>
  value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);

/** One line for an audit row's `summary` ({ before?, after?, note? }); '' when empty. */
export function auditSummaryText(summary) {
  if (!summary) return '';
  const parts = [];
  if (summary.note) parts.push(summary.note);
  const hasBefore = summary.before !== undefined && summary.before !== null;
  const hasAfter = summary.after !== undefined && summary.after !== null;
  if (hasBefore && hasAfter) parts.push(`${shown(summary.before)} → ${shown(summary.after)}`);
  else if (hasAfter) parts.push(`now ${shown(summary.after)}`);
  else if (hasBefore) parts.push(`was ${shown(summary.before)}`);
  return parts.join(' · ');
}

/** "12 Oct 2026" (UTC), or an em dash for nothing. */
export function shortDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ---------------------------------------------------------------------------
// Users, workspaces, monitors: status and tone

/** Badge tones are the Badge component's: green, red, amber, blue, neutral. */
export function accountStatus(row) {
  return row?.suspendedAt
    ? { label: 'Suspended', tone: 'red', suspended: true }
    : { label: 'Active', tone: 'green', suspended: false };
}

export const PLATFORM_ROLES = { superadmin: 'Superadmin', user: 'User' };
export const platformRoleLabel = (role) => PLATFORM_ROLES[role] ?? PLATFORM_ROLES.user;

const PROVIDER_LABELS = { github: 'GitHub', google: 'Google' };

/** "GitHub, Google", or "Email and password" when no provider is linked. */
export function providersText(providers) {
  if (!providers?.length) return 'Email and password';
  return providers.map((p) => PROVIDER_LABELS[p] ?? p).join(', ');
}

/**
 * Why an action on this user is not offered, or null when it is. The server refuses the
 * same cases (409 ADMIN_PROTECTED); this explains it before the click.
 */
export function protectedReason(target, me) {
  if (!target) return null;
  if (me?.id && target.id === me.id) return "You can't do this to your own account.";
  if (target.platformRole === 'superadmin') return 'Platform administrators are protected.';
  return null;
}

export const PAUSED_BY_LABELS = {
  admin: 'Paused by an administrator',
  user: 'Paused by the owner',
  budget: 'Paused: monthly budget reached',
};

/** The line shown for a monitor's state, saying who paused it when it is paused. */
export function monitorStateLabel(row) {
  if (row?.isPaused || row?.status === 'paused') {
    return PAUSED_BY_LABELS[row.pausedBy] ?? 'Paused';
  }
  return statusStyle(row?.status).label;
}

/** Badge tone for a monitor row: an administrator's pause is amber so it stands out. */
export function monitorTone(row) {
  if (row?.isPaused && row.pausedBy === 'admin') return 'amber';
  if (row?.isPaused) return 'neutral';
  return statusStyle(row?.status).tone;
}

/** Whether Pause (not Resume) is the action a monitor row offers. */
export const canPause = (row) => !row?.isPaused;

export const MONITOR_STATUSES = ['up', 'down', 'pending', 'paused', 'degraded'];
export const MONITOR_TYPES = ['http', 'heartbeat', 'agent'];
export const TYPE_LABELS = { http: 'HTTP', heartbeat: 'Heartbeat', agent: 'App agent' };
export const monitorTypeLabel = (type) => TYPE_LABELS[type] ?? type ?? '';

export function incidentTone(incident) {
  return incident?.resolvedAt
    ? { label: 'Resolved', tone: 'neutral' }
    : { label: 'Open', tone: 'red' };
}

// ---------------------------------------------------------------------------
// Row selection (monitor bulk actions)

/** A new Set with `id` toggled. */
export function toggleId(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 'all' | 'some' | 'none' for the header checkbox. */
export function selectionState(rows, selected) {
  const count = rows.filter((row) => selected.has(row.id)).length;
  if (count === 0) return 'none';
  return count === rows.length ? 'all' : 'some';
}

/** Selecting the page selects every row on it; selecting again clears them. */
export function togglePage(rows, selected) {
  const next = new Set(selected);
  if (selectionState(rows, selected) === 'all') rows.forEach((row) => next.delete(row.id));
  else rows.forEach((row) => next.add(row.id));
  return next;
}

export const BULK_MAX = 100;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The toast for a bulk action's `{ changed, skipped, failed }`. */
export function bulkResultMessage(action, result) {
  const { changed = 0, skipped = 0, failed = [] } = result ?? {};
  const verb = { pause: 'Paused', resume: 'Resumed', delete: 'Deleted' }[action] ?? 'Changed';
  const parts = [`${verb} ${plural(changed, 'monitor')}`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed.length) {
    parts.push(`${failed.length} failed (${failed.map((item) => item.name).join(', ')})`);
  }
  return parts.join('; ');
}

/** The toast for a monitor's "Test now" result `{ ok, statusCode, totalMs, error }`. */
export function testResultMessage(result) {
  if (!result) return 'No result';
  const ms = result.totalMs == null ? '' : ` in ${Math.round(result.totalMs)} ms`;
  if (result.ok)
    return `Check passed${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}${ms}`;
  const why = result.error || (result.statusCode ? `HTTP ${result.statusCode}` : 'no response');
  return `Check failed: ${why}${ms}`;
}

// ---------------------------------------------------------------------------
// Overview

/** "since 12 Oct 2026", or a plain sentence when alert logging has not started. */
export function alertsSinceText(since) {
  if (!since) return 'Alert history has not started yet.';
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) return 'Alert history has not started yet.';
  return `Since ${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

export const CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'discord', label: 'Discord' },
  { key: 'slack', label: 'Slack' },
];

export function alertRows(perChannel) {
  return CHANNELS.map(({ key, label }) => ({
    key,
    label,
    sent: perChannel?.[key]?.sent ?? 0,
    failed: perChannel?.[key]?.failed ?? 0,
  }));
}

/** [{ date, label: 'Oct 3', checks }] for the 30-day chart. */
export function checksPerDayRows(checksPerDay = []) {
  return checksPerDay.map(({ date, checks }) => ({
    key: date,
    date,
    label: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    checks,
  }));
}

export function monitorTypeRows(byType = {}) {
  return MONITOR_TYPES.map((type) => ({
    key: type,
    label: monitorTypeLabel(type),
    count: byType[type] ?? 0,
  }));
}

export function monitorStatusRows(byStatus = {}) {
  return MONITOR_STATUSES.map((status) => ({
    key: status,
    label: statusStyle(status).label,
    count: byStatus[status] ?? 0,
    color: `var(--status-${status})`,
  }));
}

/** Share of push-monitor requests that were saved, 0-100 (whole number), or null with no traffic. */
export function savedPercent(requestsSaved) {
  const sent = requestsSaved?.requestsSent ?? 0;
  const saved = requestsSaved?.requestsSaved ?? 0;
  const total = sent + saved;
  return total > 0 ? Math.round((saved / total) * 100) : null;
}

/** "₹432 + $12", or "—" when there is no cost. */
export function monthlyCostText(monthlyCost) {
  if (!monthlyCost?.length) return '—';
  return monthlyCost.map(({ currency, amount }) => formatCurrency(amount, currency)).join(' + ');
}

// ---------------------------------------------------------------------------
// System

export const WORKER_STATES = {
  running: { label: 'Running', tone: 'green' },
  stale: { label: 'Stale', tone: 'amber' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const workerState = (status) => WORKER_STATES[status] ?? WORKER_STATES.unknown;

export function apiState(status) {
  return status === 'ok'
    ? { label: 'OK', tone: 'green' }
    : { label: status ?? 'Unknown', tone: 'red' };
}

export function changeStreamsState(value) {
  return value === 'live'
    ? { label: 'Live', tone: 'green' }
    : { label: value ? String(value) : 'Unknown', tone: 'amber' };
}

/** Queue health: failed jobs make it red; anything else is calm. */
export function queueState(queue) {
  if (!queue) return { label: 'Unknown', tone: 'neutral' };
  if (queue.failed > 0) return { label: `${queue.failed} failed`, tone: 'red' };
  return { label: 'Healthy', tone: 'green' };
}

export const uptimeText = (uptimeSec) => formatDuration(uptimeSec);

/** Total alert failures across channels in the last 24 h. */
export function alertFailuresTotal(last24h) {
  return CHANNELS.reduce((sum, { key }) => sum + (last24h?.[key] ?? 0), 0);
}

/** The sentence for a server error row: "GET /monitors/:id -> 500 (CODE)". */
export function errorLine(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${error?.method ?? ''} ${error?.route ?? ''} → ${error?.status ?? ''}${code}`.trim();
}

/** True when a viewer should see the suspended-workspace banner. */
export const isWorkspaceSuspended = (workspace) => Boolean(workspace?.suspendedAt);

/** Banner text for a suspended workspace, with the reason when there is one. */
export function suspendedBannerText(workspace) {
  const reason = workspace?.suspendedReason?.trim();
  return reason
    ? `This workspace is suspended: ${reason}`
    : 'This workspace is suspended by an administrator.';
}
