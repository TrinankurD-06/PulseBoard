import { redactMessage } from '@pulseboard/shared/alerts';
import { AlertLog } from '@pulseboard/shared/models';

/**
 * One row per delivery attempt, for the admin overview and system health. It must never make an
 * alert fail or retry, so a failure to write it is swallowed. No address, URL or message body is kept.
 */
export async function logAlertAttempt({ channel, ok, error, incidentId, workspaceId }) {
  try {
    await AlertLog.create({
      channelType: channel.type,
      ok,
      error: ok ? null : redactMessage(error?.message ?? error, 300),
      incidentId: incidentId ?? null,
      workspaceId: workspaceId ?? channel.workspaceId ?? null,
    });
  } catch {
    // Logging is best effort.
  }
}
