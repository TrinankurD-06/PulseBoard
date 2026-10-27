import { Link } from 'react-router-dom';
import { agentIntervalLabel, agentState, isAgent } from '../../lib/agent.js';
import { intervalLabel } from '../../lib/budget.js';
import { cn } from '../../lib/cn.js';
import { formatMs, hostOf, timeAgoShort } from '../../lib/format.js';
import { heartbeatIntervalLabel, heartbeatState, isHeartbeat } from '../../lib/heartbeat.js';
import { statusStyle } from '../../lib/status.js';
import Sparkline from '../charts/Sparkline.jsx';
import RingDot from '../ui/RingDot.jsx';
import StatusDot from './StatusDot.jsx';

const VARIANTS = {
  http: {
    subtitle: (monitor) => hostOf(monitor.url),
    strip: null,
    last: { label: 'Checked', field: 'lastCheckedAt' },
    interval: intervalLabel,
  },
  heartbeat: {
    subtitle: () => 'Heartbeat (your job pings us)',
    strip: (monitor, now) => heartbeatState(monitor, now).text,
    last: { label: 'Last ping', field: 'lastPingAt' },
    interval: heartbeatIntervalLabel,
  },
  agent: {
    subtitle: () => 'App agent (your app reports to us)',
    strip: (monitor, now) => agentState(monitor, now).text,
    last: { label: 'Last report', field: 'lastReportAt' },
    interval: agentIntervalLabel,
  },
};

/**
 * One monitor as a clean row: status dot, name, a tiny trend (or, for push
 * monitors, where the next ping/report stands), mono latency and a ring-dot.
 * The whole row is the link to the monitor.
 */
export default function MonitorCard({ monitor, wid, now, sparkline }) {
  const style = statusStyle(monitor.status);
  const variant = isAgent(monitor)
    ? VARIANTS.agent
    : isHeartbeat(monitor)
      ? VARIANTS.heartbeat
      : VARIANTS.http;
  const push = variant !== VARIANTS.http;
  const last = timeAgoShort(monitor[variant.last.field], now);

  return (
    <Link
      to={`/app/${wid}/monitors/${monitor.id}`}
      className="group flex items-center gap-4 border-b border-line px-1 py-5 transition-colors duration-200 ease-(--ease) first:border-t hover:bg-surface sm:gap-6 sm:px-3"
    >
      <StatusDot status={monitor.status} />
      <div className="min-w-0 flex-1 sm:flex-[1.2]">
        <h3 className="truncate text-[15px] text-fg">{monitor.name}</h3>
        <p className="mt-0.5 truncate text-xs text-faint">{variant.subtitle(monitor)}</p>
      </div>
      <div className="hidden min-w-0 flex-1 md:block">
        {push ? (
          <p className="truncate text-xs text-muted">{variant.strip(monitor, now)}</p>
        ) : (
          <div className="w-full max-w-36">
            <Sparkline points={sparkline} />
          </div>
        )}
      </div>
      <div className="w-24 text-right">
        <p className="font-mono text-[13px] text-fg">
          {push ? last : formatMs(monitor.lastResponseMs)}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-faint">
          {push ? variant.last.label : variant.interval(monitor, now)}
        </p>
      </div>
      <span
        className={cn('w-16 text-right text-xs max-sm:sr-only', style.text)}
        data-status={monitor.status}
      >
        {style.label}
      </span>
      <RingDot
        className="text-faint transition-colors duration-200 group-hover:text-fg"
        filled={false}
      />
    </Link>
  );
}
