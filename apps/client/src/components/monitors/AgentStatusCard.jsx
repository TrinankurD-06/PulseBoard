import { PiggyBank } from 'lucide-react';
import { useUsage } from '../../api/analytics.js';
import {
  agentState,
  estimateAgentMonthlyRequests,
  formatUptime,
  lastReportLabel,
  requestsSavedVsPolling,
} from '../../lib/agent.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatDuration, hostOf } from '../../lib/format.js';
import Card, { CardHeader } from '../ui/Card.jsx';

const AGENT_STATE_STYLE = {
  reporting: { dot: 'bg-status-up', text: 'text-emerald-700 dark:text-emerald-400' },
  waiting: { dot: 'bg-status-pending', text: 'text-amber-700 dark:text-amber-400' },
  late: { dot: 'bg-status-pending', text: 'text-amber-700 dark:text-amber-400' },
  probing: { dot: 'bg-status-pending', text: 'text-amber-700 dark:text-amber-400' },
  degraded: { dot: 'bg-status-pending', text: 'text-amber-700 dark:text-amber-400' },
  silent: { dot: 'bg-status-down', text: 'text-red-700 dark:text-red-400' },
  paused: { dot: 'bg-status-paused', text: 'text-slate-500' },
};

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** "≈ 42,480 requests/month saved vs 1-minute polling", from usage (or estimated locally). */
export function RequestsSaved({ usage, monitor }) {
  const saved =
    usage?.requestsSaved ??
    requestsSavedVsPolling(estimateAgentMonthlyRequests(monitor.externalCheckEverySec));
  return (
    <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
      <PiggyBank
        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
      <span>
        <span className="font-semibold tabular-nums">≈ {formatCount(saved)}</span> requests/month
        saved vs 1-minute polling
      </span>
    </p>
  );
}

/**
 * Last report / reporting state, updated live: lastReportAt and silenceState
 * arrive in check:result and patch the cached monitor. `lastReport` (from
 * agent-metrics) adds hostname, agent version and app uptime.
 */
export default function AgentStatusCard({ wid, monitor, lastReport, now }) {
  const { data: usage } = useUsage(wid, monitor.id);
  const { state, text } = agentState(monitor, now);
  const style = AGENT_STATE_STYLE[state];

  return (
    <Card>
      <CardHeader title="Reports" />
      <div className="space-y-4 p-5">
        <p className={cn('flex items-center gap-2 text-sm font-medium', style.text)} role="status">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
          {text}
        </p>
        <dl className="grid grid-cols-2 gap-4">
          <Detail label="Last report">{lastReportLabel(monitor, now)}</Detail>
          <Detail label="Reports every">{formatDuration(monitor.reportEverySec)}</Detail>
          <Detail label="Host">{lastReport?.hostname ?? '—'}</Detail>
          <Detail label="Agent version">{lastReport?.agentVersion ?? '—'}</Detail>
          <Detail label="App uptime">{formatUptime(lastReport?.uptimeSec)}</Detail>
          <Detail label="Fails when">
            5xx &gt; {monitor.errorRateThreshold}%
            {monitor.p95ThresholdMs != null && ` or p95 > ${monitor.p95ThresholdMs}ms`}
          </Detail>
          <Detail label="Probe URL">
            {monitor.probeUrl ? hostOf(monitor.probeUrl) : 'None (silence alone opens an incident)'}
          </Detail>
          <Detail label="External check">
            {monitor.externalCheckEverySec
              ? `every ${formatDuration(monitor.externalCheckEverySec)}`
              : 'Off'}
          </Detail>
          <Detail label="Reports this month">{formatCount(usage?.reports ?? 0)}</Detail>
          <Detail label="Requests to your servers">{formatCount(usage?.requests ?? 0)}</Detail>
        </dl>
        <RequestsSaved usage={usage} monitor={monitor} />
      </div>
    </Card>
  );
}
