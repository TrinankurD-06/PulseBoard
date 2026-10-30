import { buildAlert } from '@pulseboard/shared/alerts';
import { logAlertAttempt } from '../alertLog.js';
import { ALERT_RETRY_DELAYS_SEC, INCIDENT_EVENT, JOB_NAMES } from '@pulseboard/shared/constants';
import { addTimelineEntry } from '@pulseboard/shared/incident';
import { AlertChannel, Incident, Monitor } from '@pulseboard/shared/models';

const KIND_LABEL = { down: 'Down', up: 'Recovery' };
const TYPE_LABEL = { discord: 'Discord', slack: 'Slack', email: 'email' };

const channelLabel = (channel) =>
  `${TYPE_LABEL[channel.type]}${channel.name ? ` (${channel.name})` : ''}`;

/**
 * Handler for one-off `send-alert` jobs: { incidentId, channelId, kind, attempt }.
 *
 * - Idempotent: a "channelId:kind" key is recorded on the incident after a
 *   successful send, and checked first, so the same alert never goes out twice
 *   (e.g. if a job is retried after a crash).
 * - Retries with exponential backoff: on failure, a NEW job is scheduled
 *   30s, 2m, then 8m later. After that we give up. Every success and failure
 *   is written to the incident timeline.
 * - Delivery problems are handled here and never thrown, so Agenda treats the
 *   job as done (no Agenda-level retries on top of ours).
 */
export function createSendAlertJob({ agenda, senders, dashboardUrl, logger }) {
  return async function sendAlertJob(job) {
    const { incidentId, channelId, kind, attempt = 1 } = job.attrs.data;
    const [incident, channel] = await Promise.all([
      Incident.findById(incidentId).lean(),
      AlertChannel.findById(channelId).lean(),
    ]);
    // The incident or channel was deleted, or the channel switched off: nothing to do.
    if (!incident || !channel?.isEnabled) return;

    const deliveryKey = `${channelId}:${kind}`;
    if (incident.deliveredAlerts.includes(deliveryKey)) return;

    const monitor = await Monitor.findById(incident.monitorId).lean();
    if (!monitor) return;

    const what = `${KIND_LABEL[kind]} alert via ${channelLabel(channel)}`;
    try {
      const alert = buildAlert({ kind, monitor, incident, dashboardUrl });
      const info = await senders[channel.type](channel.target, alert);
      const preview = info?.previewUrl ? ` (preview: ${info.previewUrl})` : '';
      await addTimelineEntry(
        incidentId,
        { type: INCIDENT_EVENT.ALERT_SENT, message: `${what} sent${preview}` },
        { $addToSet: { deliveredAlerts: deliveryKey } },
      );
      await logAlertAttempt({ channel, ok: true, incidentId, workspaceId: incident.workspaceId });
      logger.info({ incidentId, channelId, kind }, 'Alert sent');
    } catch (err) {
      await logAlertAttempt({
        channel,
        ok: false,
        error: err,
        incidentId,
        workspaceId: incident.workspaceId,
      });
      const delaySec = ALERT_RETRY_DELAYS_SEC[attempt - 1];
      const next = delaySec ? `retrying in ${delaySec}s` : 'giving up';
      await addTimelineEntry(incidentId, {
        type: INCIDENT_EVENT.ALERT_FAILED,
        message: `${what} failed (attempt ${attempt}): ${err.message}; ${next}`,
      });
      logger.warn({ incidentId, channelId, kind, attempt, err: err.message }, 'Alert failed');
      if (delaySec) {
        await agenda.schedule(new Date(Date.now() + delaySec * 1000), JOB_NAMES.SEND_ALERT, {
          incidentId,
          channelId,
          kind,
          attempt: attempt + 1,
        });
      }
    }
  };
}
