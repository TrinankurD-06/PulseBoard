import { isDemoUserEmail } from '@pulseboard/shared/demo';
import { pausedByOf } from '../monitors/monitors.service.js';

// What the admin console may show. Every admin response is built from these explicit field lists,
// never by spreading a database document, so a new secret field added to a model cannot leak here.
// Never included, anywhere: password hashes, refresh or session tokens, OAuth tokens, agent keys
// (or their hashes), heartbeat tokens, monitor headers, webhook URLs in full.

const id = (value) => (value == null ? null : String(value));

/** A monitored URL without credentials or query string (either can hold a token). */
export function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search ? '?…' : ''}`;
  } catch {
    return null;
  }
}

/** Webhook URLs are credentials: only the last 4 characters. Email addresses are shown. */
export function maskTarget(type, target) {
  if (type === 'email') return target;
  return `…${String(target).slice(-4)}`;
}

export const providersOf = (user) => [
  ...new Set((user.identities ?? []).map((identity) => identity.provider)),
];

export function channelRow(channel, workspaceName) {
  return {
    id: id(channel._id),
    workspaceId: id(channel.workspaceId),
    workspaceName: workspaceName ?? null,
    type: channel.type,
    name: channel.name ?? null,
    targetMasked: maskTarget(channel.type, channel.target),
    isEnabled: Boolean(channel.isEnabled),
  };
}

/** `workspaces` and `owners` are Maps of id -> lean document, so a list costs two queries. */
export function monitorRow(monitor, workspaces, owners) {
  const workspace = workspaces.get(id(monitor.workspaceId));
  const owner = workspace ? owners.get(id(workspace.ownerId)) : null;
  const byAdmin = monitor.isPaused && monitor.pausedReason === 'admin';
  return {
    id: id(monitor._id),
    name: monitor.name,
    type: monitor.type,
    url: safeUrl(monitor.url),
    status: monitor.status,
    isPaused: Boolean(monitor.isPaused),
    pausedBy: pausedByOf(monitor),
    pauseNote: byAdmin ? (monitor.pauseNote ?? null) : null,
    workspace: workspace ? { id: id(workspace._id), name: workspace.name } : null,
    owner: owner ? { id: id(owner._id), name: owner.name, email: owner.email } : null,
    lastCheckedAt: monitor.lastCheckedAt ?? null,
    lastResponseMs: monitor.lastResponseMs ?? null,
    lastOk: monitor.lastOk ?? null,
  };
}

export function incidentRow(incident, monitors, workspaces) {
  const monitor = monitors.get(id(incident.monitorId));
  const workspace = workspaces.get(id(incident.workspaceId));
  return {
    id: id(incident._id),
    monitorId: id(incident.monitorId),
    monitorName: monitor?.name ?? null,
    workspace: workspace ? { id: id(workspace._id), name: workspace.name } : null,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt ?? null,
    durationSec: incident.durationSec ?? null,
    cause: incident.cause ?? null,
    causeCode: incident.causeCode ?? null,
  };
}

export const timelineRow = (entry) => ({
  at: entry.at,
  type: entry.type,
  message: entry.message ?? null,
});

export function userProfile(user, extra = {}) {
  return {
    id: id(user._id),
    name: user.name,
    email: user.email,
    providers: providersOf(user),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    platformRole: user.platformRole ?? 'user',
    suspendedAt: user.suspendedAt ?? null,
    isDemo: isDemoUserEmail(user.email),
    ...extra,
  };
}

export const auditRow = (entry) => ({
  id: id(entry._id),
  at: entry.at,
  adminId: id(entry.adminId),
  adminEmail: entry.adminEmail,
  action: entry.action,
  targetType: entry.targetType,
  targetId: entry.targetId,
  summary: {
    ...(entry.summary?.before !== undefined && { before: entry.summary.before }),
    ...(entry.summary?.after !== undefined && { after: entry.summary.after }),
    ...(entry.summary?.note && { note: entry.summary.note }),
  },
  ip: entry.ip ?? null,
});
