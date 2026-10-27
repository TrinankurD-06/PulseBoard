import { ALERT_KIND } from '../constants.js';

const WEBHOOK_TIMEOUT_MS = 10_000;
const COLORS = { down: 0xef4444, up: 0x22c55e, test: 0x38bdf8, notice: 0xf59e0b };

/**
 * POSTs JSON and throws on anything but 2xx. `redirect: 'error'` means a
 * webhook URL can't bounce the request somewhere else.
 */
async function postJson(url, body, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}

/** Discord "embed": coloured side bar, title linking to the dashboard, inline fields. */
export function discordPayload(alert) {
  return {
    username: 'PulseBoard',
    embeds: [
      {
        title: alert.title,
        url: alert.link,
        description: alert.summary,
        color: COLORS[alert.kind],
        fields: [
          // No URL field for tests and heartbeat monitors (Discord rejects empty values).
          ...(alert.kind === ALERT_KIND.TEST || !alert.url
            ? []
            : [{ name: 'URL', value: alert.url }]),
          ...alert.fields.map(([name, value]) => ({ name, value: String(value), inline: true })),
        ],
        footer: { text: 'PulseBoard uptime monitoring' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/** Slack Block Kit: header, summary, fields, and a button to the dashboard. */
export function slackPayload(alert) {
  return {
    text: `${alert.title}: ${alert.summary}`, // fallback for notifications
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: alert.title, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: alert.summary } },
      ...(alert.fields.length
        ? [
            {
              type: 'section',
              fields: alert.fields.map(([name, value]) => ({
                type: 'mrkdwn',
                text: `*${name}*\n${value}`,
              })),
            },
          ]
        : []),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open dashboard' },
            url: alert.link,
          },
        ],
      },
    ],
  };
}

export const sendDiscord = (webhookUrl, alert, fetchImpl) =>
  postJson(webhookUrl, discordPayload(alert), fetchImpl);

export const sendSlack = (webhookUrl, alert, fetchImpl) =>
  postJson(webhookUrl, slackPayload(alert), fetchImpl);
