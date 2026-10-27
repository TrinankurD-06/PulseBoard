import nodemailer from 'nodemailer';

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

// Email clients cannot read CSS variables, so the dark theme's tokens are repeated
// here as hex (see apps/client/src/styles/tokens.css). Solid hex only: Outlook
// ignores rgba() and most modern CSS.
const THEME = {
  bg: '#0A0A09',
  card: '#111110',
  border: '#2A2A25',
  text: '#ECEAD6',
  muted: '#A3A193',
  faint: '#7C7B71',
  accent: '#E3E8A8',
  accentInk: '#0A0A09',
};

// The strip across the top of the card: red for down, green for recovered,
// amber for a notice and neutral for a test.
const STRIP = { down: '#FF6A5A', up: '#B9DD8E', notice: '#E9B44C', test: '#A3A193' };
const STATUS_LABEL = { down: 'Down', up: 'Recovered', notice: 'Notice', test: 'Test alert' };

// Manrope only renders where the client loads web fonts (Apple Mail, some
// webmail); everyone else gets the system stack.
const FONT = "'Manrope', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

const buttonLabel = (alert) => (alert.kind === 'test' ? 'Open alert channels' : 'Open dashboard');

/**
 * The alert as an email: a dark card on a dark page with a status strip, in the
 * app's theme. Built from nested tables with inline styles and bgcolor
 * attributes, the one layout Gmail, Outlook and Apple Mail all render alike
 * (they strip or ignore <style> blocks, flexbox and most CSS). Returns the
 * subject, the HTML and a plain-text alternative.
 */
export function renderEmail(alert) {
  const strip = STRIP[alert.kind] ?? STRIP.test;
  const label = STATUS_LABEL[alert.kind] ?? STATUS_LABEL.test;
  const link = escapeHtml(alert.link);
  const fields = [['Monitor', alert.monitorName], ...alert.fields].filter(([, value]) => value);

  const rows = fields
    .map(
      ([name, value]) => `
              <tr>
                <td valign="top" width="120" style="padding:10px 16px 10px 0;border-top:1px solid ${THEME.border};font-family:${FONT};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${THEME.faint}">${escapeHtml(name)}</td>
                <td valign="top" style="padding:9px 0;border-top:1px solid ${THEME.border};font-family:${FONT};font-size:14px;line-height:1.5;color:${THEME.text};word-break:break-word">${escapeHtml(value)}</td>
              </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(alert.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;600&amp;display=swap" rel="stylesheet">
</head>
<body bgcolor="${THEME.bg}" style="margin:0;padding:0;background-color:${THEME.bg};color:${THEME.text}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${THEME.bg}">${escapeHtml(alert.summary)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${THEME.bg}" style="background-color:${THEME.bg}">
    <tr>
      <td align="center" style="padding:32px 12px">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
          <tr>
            <td style="padding:0 4px 18px;font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:-0.2px;color:${THEME.text}">PulseBoard</td>
          </tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${THEME.card}" style="background-color:${THEME.card};border:1px solid ${THEME.border};border-radius:16px">
                <tr>
                  <td height="4" bgcolor="${strip}" style="height:4px;line-height:4px;font-size:0;background-color:${strip};border-radius:16px 16px 0 0">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:28px 28px 8px">
                    <p style="margin:0 0 12px;font-family:${FONT};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${THEME.faint}">${escapeHtml(label)}</p>
                    <h1 style="margin:0 0 12px;font-family:${FONT};font-size:26px;line-height:1.2;font-weight:300;letter-spacing:-0.5px;color:${THEME.text}">${escapeHtml(alert.title)}</h1>
                    <p style="margin:0 0 24px;font-family:${FONT};font-size:15px;line-height:1.6;color:${THEME.muted}">${escapeHtml(alert.summary)}</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 28px 32px">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="${THEME.accent}" style="background-color:${THEME.accent};border-radius:999px">
                          <a href="${link}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1;color:${THEME.accentInk};text-decoration:none;border-radius:999px">${escapeHtml(buttonLabel(alert))}</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:18px 0 0;font-family:${MONO};font-size:11px;line-height:1.5;color:${THEME.faint};word-break:break-all"><a href="${link}" target="_blank" style="color:${THEME.faint};text-decoration:underline">${link}</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${THEME.faint}">Sent by PulseBoard uptime monitoring because this address is an alert channel in your workspace.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    alert.title,
    '',
    alert.summary,
    '',
    ...fields.map(([name, value]) => `${name}: ${value}`),
    '',
    `${buttonLabel(alert)}: ${alert.link}`,
    '',
    '-- Sent by PulseBoard uptime monitoring because this address is an alert channel in your workspace.',
  ].join('\n');

  return { subject: alert.title, html, text };
}

// A blocked or silent SMTP server must fail in seconds, not hold a job slot for
// nodemailer's default two minutes (some hosts, e.g. Render's free plan, drop
// outbound SMTP connections without answering).
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15_000;
// Resend only accepts a verified domain or its own test sender. The default
// ALERT_FROM_EMAIL (alerts@pulseboard.local) is neither, so it is swapped.
const RESEND_TEST_SENDER = 'PulseBoard <onboarding@resend.dev>';

/** Sends over Resend's HTTPS API: works where outbound SMTP is blocked. */
async function sendViaResend({ apiKey, from, to, message, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: from.includes('@pulseboard.local') ? RESEND_TEST_SENDER : from,
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('Resend did not answer in time');
    throw new Error(`Could not reach Resend: ${err.message}`);
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      `Resend rejected the email (${res.status})${detail?.message ? `: ${detail.message}` : ''}`,
    );
  }
  return { previewUrl: null };
}

/**
 * Email sender. Order of preference:
 * 1. `resendApiKey`: Resend's HTTPS API (works where SMTP is blocked).
 * 2. `smtp.host`: that SMTP server.
 * 3. Neither (local development): a free Ethereal test inbox, so nothing real
 *    is sent and each message gets a preview URL that is logged in the
 *    incident timeline.
 */
export function createEmailSender({
  smtp,
  from,
  resendApiKey,
  fetchImpl = globalThis.fetch,
  logger,
}) {
  let transporterPromise;

  function getTransporter() {
    transporterPromise ??= (async () => {
      if (smtp?.host) {
        return nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.port === 465,
          auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
          ...SMTP_TIMEOUTS,
        });
      }
      const account = await nodemailer.createTestAccount();
      logger?.info({ user: account.user }, 'No SMTP configured: using an Ethereal test inbox');
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
        ...SMTP_TIMEOUTS,
      });
    })().catch((err) => {
      transporterPromise = undefined; // allow a retry on the next alert
      throw err;
    });
    return transporterPromise;
  }

  return async function sendEmail(to, alert) {
    if (resendApiKey) {
      return sendViaResend({
        apiKey: resendApiKey,
        from,
        to,
        message: renderEmail(alert),
        fetchImpl,
      });
    }
    const transporter = await getTransporter();
    const info = await transporter.sendMail({ from, to, ...renderEmail(alert) });
    const previewUrl = nodemailer.getTestMessageUrl(info) || null;
    return { previewUrl };
  };
}
