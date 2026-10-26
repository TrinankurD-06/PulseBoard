import nodemailer from 'nodemailer';

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const ACCENT = { down: '#ef4444', up: '#22c55e', test: '#38bdf8' };

/** Simple, inline-styled HTML (email clients ignore <style> blocks and most CSS). */
export function renderEmail(alert) {
  const rows = alert.fields
    .map(
      ([name, value]) => `
        <tr>
          <td style="padding:6px 0;color:#64748b;width:120px">${escapeHtml(name)}</td>
          <td style="padding:6px 0;color:#0f172a">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="max-width:560px;background:#ffffff;border-radius:12px;border-top:4px solid ${ACCENT[alert.kind]}">
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">${escapeHtml(alert.title)}</h1>
          <p style="margin:0 0 16px;color:#334155">${escapeHtml(alert.summary)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
            <tr>
              <td style="padding:6px 0;color:#64748b;width:120px">Monitor</td>
              <td style="padding:6px 0;color:#0f172a">${escapeHtml(alert.monitorName)}</td>
            </tr>${rows}
          </table>
          <p style="margin:24px 0 0">
            <a href="${escapeHtml(alert.link)}"
              style="background:#059669;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">
              Open dashboard
            </a>
          </p>
        </td></tr>
      </table>
      <p style="color:#94a3b8;font-size:12px">Sent by PulseBoard uptime monitoring</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    alert.title,
    alert.summary,
    `Monitor: ${alert.monitorName}`,
    ...alert.fields.map(([name, value]) => `${name}: ${value}`),
    `Dashboard: ${alert.link}`,
  ].join('\n');

  return { subject: alert.title, html, text };
}

/**
 * Email sender. With SMTP settings it uses that server; without them (local
 * development) it creates a free Ethereal test inbox, so nothing real is sent
 * and each message gets a preview URL that is logged in the incident timeline.
 */
export function createEmailSender({ smtp, from, logger }) {
  let transporterPromise;

  function getTransporter() {
    transporterPromise ??= (async () => {
      if (smtp?.host) {
        return nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.port === 465,
          auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        });
      }
      const account = await nodemailer.createTestAccount();
      logger?.info({ user: account.user }, 'No SMTP configured: using an Ethereal test inbox');
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    })().catch((err) => {
      transporterPromise = undefined; // allow a retry on the next alert
      throw err;
    });
    return transporterPromise;
  }

  return async function sendEmail(to, alert) {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({ from, to, ...renderEmail(alert) });
    const previewUrl = nodemailer.getTestMessageUrl(info) || null;
    return { previewUrl };
  };
}
