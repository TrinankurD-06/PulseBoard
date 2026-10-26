import { ALERT_KIND, NOTICE_KIND } from '../constants.js';

const formatNumber = (value) => Number(value).toLocaleString('en-US');

/**
 * Builds a notice: an alert that isn't about an incident (budget warnings,
 * and from U4 "agent silent"). Same channel-agnostic shape as buildAlert(),
 * so every sender can format it; `kind: 'notice'` gives it amber styling.
 *
 * details: { requests, budget, month, budgetAction, slowIntervalSec }
 */
export function buildNotice({ noticeKind, monitor, details = {}, dashboardUrl }) {
  const link = `${dashboardUrl.replace(/\/$/, '')}/app/${monitor.workspaceId}/monitors/${monitor._id ?? monitor.id}`;
  const base = { kind: ALERT_KIND.NOTICE, monitorName: monitor.name, url: monitor.url, link };
  const used = `${formatNumber(details.requests)} of ${formatNumber(details.budget)} requests`;
  const atLimit =
    details.budgetAction === 'pause'
      ? 'checks pause until the 1st of next month'
      : `checks slow down to every ${Math.round((details.slowIntervalSec ?? 900) / 60)} min until the 1st of next month`;

  if (noticeKind === NOTICE_KIND.BUDGET_WARNING) {
    const percent = Math.floor((details.requests / details.budget) * 100);
    return {
      ...base,
      title: `⚠️ ${monitor.name}: ${percent}% of this month's request budget used`,
      summary: `${used} used in ${details.month}. When the budget is reached, ${atLimit}.`,
      fields: [
        ['Used', used],
        ['At 100%', atLimit],
      ],
    };
  }

  if (noticeKind === NOTICE_KIND.BUDGET_EXCEEDED) {
    const action =
      details.budgetAction === 'pause'
        ? 'Monitoring is paused until the 1st of next month'
        : `Checks now run every ${Math.round((details.slowIntervalSec ?? 900) / 60)} min until the 1st of next month`;
    return {
      ...base,
      title: `⛔ ${monitor.name}: monthly request budget reached`,
      summary: `${used} used in ${details.month}. ${action}. Raise the budget to restore normal checks.`,
      fields: [
        ['Used', used],
        ['Action', action],
      ],
    };
  }

  throw new Error(`Unknown notice kind: ${noticeKind}`);
}
