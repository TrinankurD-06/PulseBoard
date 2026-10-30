import { buildNotice } from '@pulseboard/shared/alerts';
import { logAlertAttempt } from '../alertLog.js';
import { ALERT_RETRY_DELAYS_SEC, JOB_NAMES } from '@pulseboard/shared/constants';
import { AlertChannel, Monitor } from '@pulseboard/shared/models';

/**
 * Handler for one-off `send-notice` jobs:
 * { monitorId, channelId, noticeKind, details, attempt }.
 *
 * Notices are alerts that aren't about an incident (budget warnings, budget
 * reached). "Once per month" is decided before queuing (atomic markers), so
 * this job only delivers, with the same 30s / 2m / 8m retries as send-alert.
 * Delivery errors are handled here and never thrown.
 */
export function createSendNoticeJob({ agenda, senders, dashboardUrl, logger }) {
  return async function sendNoticeJob(job) {
    const { monitorId, channelId, noticeKind, details, attempt = 1 } = job.attrs.data;
    const [monitor, channel] = await Promise.all([
      Monitor.findById(monitorId).lean(),
      AlertChannel.findById(channelId).lean(),
    ]);
    if (!monitor || !channel?.isEnabled) return;

    try {
      const notice = buildNotice({ noticeKind, monitor, details, dashboardUrl });
      await senders[channel.type](channel.target, notice);
      await logAlertAttempt({ channel, ok: true, workspaceId: monitor.workspaceId });
      logger.info({ monitorId, channelId, noticeKind }, 'Notice sent');
    } catch (err) {
      await logAlertAttempt({ channel, ok: false, error: err, workspaceId: monitor.workspaceId });
      const delaySec = ALERT_RETRY_DELAYS_SEC[attempt - 1];
      logger.warn(
        {
          monitorId,
          channelId,
          noticeKind,
          attempt,
          err: err.message,
          retryInSec: delaySec ?? null,
        },
        'Notice failed',
      );
      if (delaySec) {
        await agenda.schedule(new Date(Date.now() + delaySec * 1000), JOB_NAMES.SEND_NOTICE, {
          monitorId,
          channelId,
          noticeKind,
          details,
          attempt: attempt + 1,
        });
      }
    }
  };
}
