// Node-only alert delivery. Used by the worker (incident alerts) and the API
// ("send test alert"). Never import from the client.
import { createEmailSender } from './email.js';
import { sendDiscord, sendSlack } from './webhooks.js';

export * from './email.js';
export * from './message.js';
export * from './notice.js';
export * from './webhooks.js';

/**
 * One sender per channel type: (target, alert) => Promise<{ previewUrl? } | void>.
 * Tests pass fakes with the same shape instead.
 */
export function createAlertSenders({ smtp, from, resendApiKey, logger }) {
  return {
    discord: (target, alert) => sendDiscord(target, alert),
    slack: (target, alert) => sendSlack(target, alert),
    email: createEmailSender({ smtp, from, resendApiKey, logger }),
  };
}
