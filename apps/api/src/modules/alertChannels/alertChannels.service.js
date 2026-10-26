import { ALERT_KIND, ROLES } from '@pulseboard/shared/constants';
import { buildAlert } from '@pulseboard/shared/alerts';
import { AlertChannel } from '@pulseboard/shared/models';
import { hasRole } from '@pulseboard/shared/roles';
import { alertChannelSchema } from '@pulseboard/shared/schemas';
import { AppError, notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Webhook URLs are credentials (anyone holding one can post to the channel),
 * so viewers only see enough to recognise the channel.
 */
function maskTarget(type, target) {
  if (type === 'email') {
    const [user, domain] = target.split('@');
    return `${user.charAt(0)}•••@${domain}`;
  }
  const url = new URL(target);
  return `${url.origin}/•••`;
}

export function toChannelDto(channel, role) {
  const json = channel.toJSON();
  if (!hasRole(role, ROLES.MEMBER)) json.target = maskTarget(json.type, json.target);
  return json;
}

export function createAlertChannelService({ senders, env }) {
  async function findInWorkspace(workspaceId, channelId) {
    if (!OBJECT_ID.test(channelId)) throw notFound('Alert channel not found');
    const channel = await AlertChannel.findOne({ _id: channelId, workspaceId });
    if (!channel) throw notFound('Alert channel not found');
    return channel;
  }

  return {
    list(workspaceId, pagination) {
      return paginate(AlertChannel, { workspaceId }, pagination, (query) =>
        query.sort({ createdAt: 1 }),
      );
    },

    create(workspaceId, input) {
      return AlertChannel.create({ ...input, workspaceId });
    },

    /** Merge, then re-validate the whole channel so type and target always match. */
    async update(workspaceId, channelId, patch) {
      const channel = await findInWorkspace(workspaceId, channelId);
      const current = {
        name: channel.name,
        type: channel.type,
        target: channel.target,
        isEnabled: channel.isEnabled,
      };
      channel.set(alertChannelSchema.parse({ ...current, ...patch }));
      await channel.save();
      return channel;
    },

    async remove(workspaceId, channelId) {
      const channel = await findInWorkspace(workspaceId, channelId);
      await channel.deleteOne();
    },

    /**
     * Sends a test alert right away (not via Agenda) so the user sees at once
     * whether the webhook/email works.
     */
    async sendTest(workspaceId, channelId) {
      const channel = await findInWorkspace(workspaceId, channelId);
      const alert = buildAlert({
        kind: ALERT_KIND.TEST,
        monitor: { _id: 'test', workspaceId, name: 'Test monitor', url: 'https://example.com' },
        dashboardUrl: env.DASHBOARD_URL,
      });
      try {
        const info = await senders[channel.type](channel.target, alert);
        return { delivered: true, previewUrl: info?.previewUrl ?? null };
      } catch (err) {
        throw new AppError(502, 'ALERT_DELIVERY_FAILED', `Could not deliver: ${err.message}`);
      }
    },

    findInWorkspace,
  };
}
