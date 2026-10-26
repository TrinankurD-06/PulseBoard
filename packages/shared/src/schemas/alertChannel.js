import { z } from 'zod';
import { ALERT_CHANNEL_TYPES } from '../constants.js';

// Webhook URLs must point at the real Discord/Slack hosts. Besides catching
// typos, this stops the "send alert" feature from being used to make our
// servers POST to arbitrary (internal) URLs.
const DISCORD_WEBHOOK =
  /^https:\/\/(?:discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+\/?$/;
const SLACK_WEBHOOK =
  /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+\/?$/;

const TARGET_RULES = {
  email: {
    check: (value) => z.string().email().safeParse(value).success,
    message: 'Enter a valid email address',
  },
  discord: {
    check: (value) => DISCORD_WEBHOOK.test(value),
    message: 'Enter a Discord webhook URL (https://discord.com/api/webhooks/...)',
  },
  slack: {
    check: (value) => SLACK_WEBHOOK.test(value),
    message: 'Enter a Slack webhook URL (https://hooks.slack.com/services/...)',
  },
};

const fields = z.object({
  name: z.string().trim().max(80).optional(),
  type: z.enum(ALERT_CHANNEL_TYPES),
  target: z.string().trim().min(1, 'Required').max(500),
  isEnabled: z.boolean(),
});

/** The target must match the channel type (email address vs. webhook URL). */
function targetMatchesType(channel, ctx) {
  const rule = TARGET_RULES[channel.type];
  if (rule && !rule.check(channel.target)) {
    ctx.addIssue({ code: 'custom', path: ['target'], message: rule.message });
  }
}

export const alertChannelSchema = fields
  .extend({ isEnabled: fields.shape.isEnabled.default(true) })
  .superRefine(targetMatchesType);

/** PATCH: any subset of fields; the API re-validates the merged channel with alertChannelSchema. */
export const updateAlertChannelSchema = fields
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
