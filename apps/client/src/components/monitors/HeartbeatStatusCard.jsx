import { useUsage } from '../../api/analytics.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatDuration } from '../../lib/format.js';
import { heartbeatState, lastPingLabel } from '../../lib/heartbeat.js';
import Card, { CardHeader } from '../ui/Card.jsx';

const STATE_STYLE = {
  ok: { dot: 'bg-status-up', text: 'text-emerald-700 dark:text-emerald-400' },
  waiting: { dot: 'bg-status-pending', text: 'text-amber-700 dark:text-amber-400' },
  overdue: { dot: 'bg-status-down', text: 'text-red-700 dark:text-red-400' },
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

/**
 * Last ping / next expected ping, updated live: lastPingAt and nextDueAt
 * arrive in check:result and patch the cached monitor. `now` ticks from the page.
 */
export default function HeartbeatStatusCard({ wid, monitor, now }) {
  const { data: usage } = useUsage(wid, monitor.id);
  const { state, text } = heartbeatState(monitor, now);
  const style = STATE_STYLE[state];

  return (
    <Card>
      <CardHeader title="Pings" />
      <div className="space-y-4 p-5">
        <p className={cn('flex items-center gap-2 text-sm font-medium', style.text)} role="status">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
          {text}
        </p>
        <dl className="grid grid-cols-2 gap-4">
          <Detail label="Last ping">{lastPingLabel(monitor, now)}</Detail>
          <Detail label="Expected every">{formatDuration(monitor.expectedEverySec)}</Detail>
          <Detail label="Grace period">
            {monitor.graceSec ? formatDuration(monitor.graceSec) : 'None'}
          </Detail>
          <Detail label="Last run">
            {monitor.lastOk === false && monitor.lastError
              ? monitor.lastError
              : monitor.lastResponseMs != null
                ? `took ${formatDuration(monitor.lastResponseMs / 1000)}`
                : '—'}
          </Detail>
          <Detail label="Pings this month">{formatCount(usage?.pings ?? 0)}</Detail>
          <Detail label="Requests to your servers">0</Detail>
        </dl>
      </div>
    </Card>
  );
}
