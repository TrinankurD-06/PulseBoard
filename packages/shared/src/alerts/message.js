import { ALERT_KIND } from '../constants.js';

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
 */
export function buildAlert({ kind, monitor, incident, dashboardUrl }) {
  const link = `${dashboardUrl.replace(/\/$/, '')}/app/${monitor.workspaceId}/monitors/${monitor._id ?? monitor.id}`;
  const base = { kind, monitorName: monitor.name, url: monitor.url, link };

  if (kind === ALERT_KIND.TEST) {
    return {
      ...base,
      title: `Test alert from PulseBoard`,
      summary: 'This channel is set up correctly. Real alerts will look like this.',
      fields: [],
    };
  }

  if (kind === ALERT_KIND.DOWN) {
    return {
      ...base,
      title: `🔴 ${monitor.name} is DOWN`,
      summary: `${monitor.url} has failed its last checks.`,
      fields: [
        ['Cause', incident.cause || 'Unknown'],
        ['Down since', new Date(incident.startedAt).toUTCString()],
      ],
    };
  }

  return {
    ...base,
    title: `✅ ${monitor.name} is back UP`,
    summary: `${monitor.url} is responding normally again.`,
    fields: [
      ['Downtime', humanDuration(incident.durationSec ?? 0)],
      ['Cause', incident.cause || 'Unknown'],
    ],
  };
}
