import { ALERT_KIND, MONITOR_TYPES } from '../constants.js';
import { alertChannelsLink, monitorLink } from './links.js';

/** 3725 -> "1h 2m 5s". Used in alert text. */
export function humanDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const parts = [
    [Math.floor(s / 86_400), 'd'],
    [Math.floor((s % 86_400) / 3_600), 'h'],
    [Math.floor((s % 3_600) / 60), 'm'],
    [s % 60, 's'],
  ].filter(([value]) => value > 0);
  return parts.length ? parts.map(([value, unit]) => `${value}${unit}`).join(' ') : '0s';
}

/**
 * Builds a channel-agnostic description of an alert. Each sender (Discord,
 * Slack, email) only decides how to *format* it, so the content stays the
 * same everywhere.
 *
 * A real alert links to its monitor's page. A test alert has no monitor (the
 * caller passes a placeholder), so it links to the workspace's Alert channels
 * page instead; it needs `workspaceId`, a real monitor carries its own.
 */
export function buildAlert({ kind, monitor, incident, dashboardUrl, workspaceId }) {
  const isTest = kind === ALERT_KIND.TEST;
  const link = isTest
    ? alertChannelsLink(dashboardUrl, workspaceId ?? monitor?.workspaceId)
    : monitorLink(dashboardUrl, monitor.workspaceId, monitor._id ?? monitor.id);
  const base = { kind, monitorName: monitor?.name, url: monitor?.url, link };

  if (isTest) {
    return {
      ...base,
      title: `Test alert from PulseBoard`,
      summary: 'This channel is set up correctly. Real alerts will look like this.',
      fields: [],
    };
  }

  // Heartbeat monitors have no URL: the alert talks about pings instead.
  // Agent monitors talk about their reports (and probes).
  const isHeartbeat = monitor.type === MONITOR_TYPES.HEARTBEAT;
  const isAgent = monitor.type === MONITOR_TYPES.AGENT;
  if (isAgent) base.url = monitor.probeUrl ?? null;

  if (kind === ALERT_KIND.DOWN) {
    const since = monitor.lastPingAt
      ? new Date(monitor.lastPingAt).toUTCString()
      : 'it was created';
    let summary = `${monitor.url} has failed its last checks.`;
    if (isHeartbeat) summary = `No ping from ${monitor.name} since ${since}.`;
    if (isAgent) summary = `${monitor.name} is failing: its agent reports or probes failed.`;
    return {
      ...base,
      title: `🔴 ${monitor.name} is DOWN`,
      summary,
      fields: [
        ['Cause', incident.cause || 'Unknown'],
        ['Down since', new Date(incident.startedAt).toUTCString()],
      ],
    };
  }

  if (kind === ALERT_KIND.NOTICE) {
    throw new Error('Use buildNotice() for notices');
  }

  let summary = `${monitor.url} is responding normally again.`;
  if (isHeartbeat) summary = `${monitor.name} is sending pings again.`;
  if (isAgent) summary = `${monitor.name} is reporting healthy metrics again.`;
  return {
    ...base,
    title: `✅ ${monitor.name} is back UP`,
    summary,
    fields: [
      ['Downtime', humanDuration(incident.durationSec ?? 0)],
      ['Cause', incident.cause || 'Unknown'],
    ],
  };
}
