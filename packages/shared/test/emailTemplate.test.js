import { describe, expect, it } from 'vitest';
import { buildAlert, buildNotice, renderEmail } from '../src/alerts/index.js';

const CLIENT = 'https://app.pulseboard.dev';
const monitor = { _id: 'm1', workspaceId: 'w1', name: 'Checkout API', url: 'https://x.test' };
const incident = {
  cause: 'Unexpected status 503',
  startedAt: new Date('2026-10-27T17:45:00Z'),
  durationSec: 1320,
};

const rendered = {
  down: renderEmail(buildAlert({ kind: 'down', monitor, incident, dashboardUrl: CLIENT })),
  up: renderEmail(buildAlert({ kind: 'up', monitor, incident, dashboardUrl: CLIENT })),
  test: renderEmail(
    buildAlert({
      kind: 'test',
      workspaceId: 'w1',
      monitor: { name: 'Test monitor' },
      dashboardUrl: CLIENT,
    }),
  ),
  notice: renderEmail(
    buildNotice({
      noticeKind: 'budget_warning',
      monitor,
      details: { requests: 800, budget: 1000, month: '2026-10' },
      dashboardUrl: CLIENT,
    }),
  ),
};

describe('alert email template', () => {
  it('uses the dark theme: page, text and a lime button', () => {
    for (const { html } of Object.values(rendered)) {
      expect(html).toContain('background-color:#0A0A09'); // page
      expect(html).toContain('bgcolor="#0A0A09"');
      expect(html).toContain('color:#ECEAD6'); // warm off-white text
      expect(html).toContain('background-color:#E3E8A8'); // pale lime button
      expect(html).toContain('color:#0A0A09;text-decoration:none'); // ink on the button
      expect(html).toContain("'Manrope'");
      expect(html).toMatch(/Helvetica, Arial, sans-serif/); // system fallback
    }
  });

  it('shows a status strip: red for down, green for recovered, amber for a notice, neutral for a test', () => {
    expect(rendered.down.html).toContain('bgcolor="#FF6A5A"');
    expect(rendered.up.html).toContain('bgcolor="#B9DD8E"');
    expect(rendered.notice.html).toContain('bgcolor="#E9B44C"');
    expect(rendered.test.html).toContain('bgcolor="#A3A193"');
    expect(rendered.down.html).not.toContain('bgcolor="#B9DD8E"');
  });

  it('is table-based with inline styles only, as Gmail and Outlook require', () => {
    for (const { html } of Object.values(rendered)) {
      expect(html).toContain('<table role="presentation"');
      expect(html).not.toMatch(/<style[\s>]/i); // clients strip style blocks
      expect(html).not.toMatch(/display\s*:\s*(flex|grid)/i);
      expect(html).not.toMatch(/rgba?\(|var\(--/); // Outlook ignores both
      expect(html).not.toMatch(/\bclass=/);
    }
  });

  it('puts the right link and label on the button', () => {
    expect(rendered.down.html).toContain(`href="${CLIENT}/app/w1/monitors/m1"`);
    expect(rendered.down.html).toContain('>Open dashboard<');
    expect(rendered.test.html).toContain(`href="${CLIENT}/app/w1/alerts"`);
    expect(rendered.test.html).toContain('>Open alert channels<');
    expect(rendered.test.html).not.toContain('/monitors/');
  });

  it('includes a plain-text version with the same link', () => {
    expect(rendered.down.text).toContain('Checkout API is DOWN');
    expect(rendered.down.text).toContain('Cause: Unexpected status 503');
    expect(rendered.down.text).toContain(`Open dashboard: ${CLIENT}/app/w1/monitors/m1`);
    expect(rendered.test.text).toContain(`Open alert channels: ${CLIENT}/app/w1/alerts`);
    expect(rendered.down.text).not.toContain('<');
  });

  it('uses the alert title as the subject and the summary as the hidden preheader', () => {
    expect(rendered.down.subject).toBe('🔴 Checkout API is DOWN');
    expect(rendered.down.html).toMatch(/display:none[^>]*>https:\/\/x\.test has failed/);
  });

  it('escapes anything that came from a monitor or a failure message', () => {
    const evil = buildAlert({
      kind: 'down',
      monitor: { ...monitor, name: '<img src=x onerror=alert(1)>' },
      incident: { ...incident, cause: '"><script>x</script>' },
      dashboardUrl: CLIENT,
    });
    const { html } = renderEmail(evil);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omits empty field values instead of rendering blank rows', () => {
    const alert = buildAlert({ kind: 'down', monitor, incident, dashboardUrl: CLIENT });
    alert.fields.push(['Empty', '']);
    expect(renderEmail(alert).html).not.toContain('>Empty<');
  });
});
