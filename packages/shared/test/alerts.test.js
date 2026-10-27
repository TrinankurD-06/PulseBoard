import { describe, expect, it } from 'vitest';
import {
  buildAlert,
  discordPayload,
  humanDuration,
  renderEmail,
  sendDiscord,
  slackPayload,
} from '../src/alerts/index.js';
import { alertChannelSchema } from '../src/schemas/alertChannel.js';

const monitor = {
  _id: 'm1',
  workspaceId: 'w1',
  name: 'Checkout API',
  url: 'https://shop.example/health',
};
const incident = {
  cause: 'Unexpected status 503 (expected 200–399)',
  startedAt: new Date('2026-01-01T10:00:00Z'),
  durationSec: 3725,
};
const dashboardUrl = 'https://app.pulseboard.dev/';

describe('buildAlert', () => {
  it('describes a down alert with cause and a dashboard link', () => {
    const alert = buildAlert({ kind: 'down', monitor, incident, dashboardUrl });
    expect(alert.title).toBe('🔴 Checkout API is DOWN');
    expect(alert.link).toBe('https://app.pulseboard.dev/app/w1/monitors/m1');
    expect(alert.fields).toContainEqual(['Cause', incident.cause]);
  });

  it('describes a recovery with the downtime', () => {
    const alert = buildAlert({ kind: 'up', monitor, incident, dashboardUrl });
    expect(alert.title).toBe('✅ Checkout API is back UP');
    expect(alert.fields).toContainEqual(['Downtime', '1h 2m 5s']);
  });
});

describe('humanDuration', () => {
  it('formats seconds compactly', () => {
    expect(humanDuration(0)).toBe('0s');
    expect(humanDuration(42)).toBe('42s');
    expect(humanDuration(90_061)).toBe('1d 1h 1m 1s');
  });
});

describe('channel payloads', () => {
  const alert = buildAlert({ kind: 'down', monitor, incident, dashboardUrl });

  it('Discord: red embed with URL and fields', () => {
    const [embed] = discordPayload(alert).embeds;
    expect(embed.color).toBe(0xef4444);
    expect(embed.url).toBe(alert.link);
    expect(embed.fields.map((f) => f.name)).toEqual(['URL', 'Cause', 'Down since']);
  });

  it('Slack: header, fields and a dashboard button', () => {
    const payload = slackPayload(alert);
    expect(payload.text).toContain('Checkout API is DOWN');
    expect(payload.blocks.map((b) => b.type)).toEqual(['header', 'section', 'section', 'actions']);
    expect(payload.blocks.at(-1).elements[0].url).toBe(alert.link);
  });

  it('email: escapes HTML from monitor data', () => {
    const evil = buildAlert({
      kind: 'down',
      monitor: { ...monitor, name: '<script>x</script>' },
      incident,
      dashboardUrl,
    });
    const { html, text, subject } = renderEmail(evil);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(text).toContain('Open dashboard: https://app.pulseboard.dev/app/w1/monitors/m1');
    expect(subject).toContain('is DOWN');
  });
});

describe('sendDiscord', () => {
  const alert = buildAlert({ kind: 'down', monitor, incident, dashboardUrl });

  it('POSTs JSON and refuses to follow redirects', async () => {
    let request;
    const fakeFetch = async (url, options) => {
      request = { url, ...options };
      return new Response(null, { status: 204 });
    };
    await sendDiscord('https://discord.com/api/webhooks/1/abc', alert, fakeFetch);
    expect(request.method).toBe('POST');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body).embeds).toHaveLength(1);
  });

  it('throws with the status and body on a non-2xx response', async () => {
    const fakeFetch = async () => new Response('Unknown Webhook', { status: 404 });
    await expect(sendDiscord('https://discord.com/x', alert, fakeFetch)).rejects.toThrow(
      'HTTP 404: Unknown Webhook',
    );
  });
});

describe('alertChannelSchema', () => {
  const parse = (input) => alertChannelSchema.safeParse(input);

  it('accepts real Discord and Slack webhook URLs and emails', () => {
    expect(
      parse({ type: 'discord', target: 'https://discord.com/api/webhooks/123/abc-DEF_9' }).success,
    ).toBe(true);
    expect(
      parse({ type: 'slack', target: 'https://hooks.slack.com/services/T0/B0/xyz123' }).success,
    ).toBe(true);
    expect(parse({ type: 'email', target: 'ops@example.com' }).data.isEnabled).toBe(true);
  });

  it('rejects targets that do not match the type (and arbitrary URLs)', () => {
    for (const input of [
      { type: 'discord', target: 'https://evil.example/api/webhooks/1/a' },
      { type: 'discord', target: 'http://discord.com/api/webhooks/1/a' },
      { type: 'slack', target: 'https://discord.com/api/webhooks/1/a' },
      { type: 'email', target: 'https://hooks.slack.com/services/T/B/x' },
    ]) {
      const result = parse(input);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toEqual(['target']);
    }
  });
});
