import { Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { intervalLabel } from '../../lib/budget.js';
import { formatMs, hostOf, timeAgoShort } from '../../lib/format.js';
import { heartbeatIntervalLabel, heartbeatState, isHeartbeat } from '../../lib/heartbeat.js';
import { statusStyle } from '../../lib/status.js';
import Sparkline from '../charts/Sparkline.jsx';
import StatusDot from './StatusDot.jsx';

/** Heartbeats have no response-time sparkline: show where the next ping stands instead. */
function HeartbeatStrip({ monitor, now }) {
  const { text } = heartbeatState(monitor, now);
  return (
    <p className="flex h-8 items-center gap-1.5 truncate text-xs text-slate-500">
      <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </p>
  );
}

export default function MonitorCard({ monitor, wid, now, sparkline }) {
  const style = statusStyle(monitor.status);
  const heartbeat = isHeartbeat(monitor);
  return (
    <Link
      to={`/app/${wid}/monitors/${monitor.id}`}
      className="group block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-500/60 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-emerald-500/50"
    >
      <div className="flex items-start gap-3">
        <StatusDot status={monitor.status} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
            {monitor.name}
          </h3>
          <p className="truncate text-sm text-slate-500">
            {heartbeat ? 'Heartbeat (your job pings us)' : hostOf(monitor.url)}
          </p>
        </div>
        <span className={`text-sm font-medium ${style.text}`}>{style.label}</span>
      </div>
      <div className="mt-4">
        {heartbeat ? (
          <HeartbeatStrip monitor={monitor} now={now} />
        ) : (
          <Sparkline points={sparkline} />
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {heartbeat ? (
          <div>
            <dt className="text-xs text-slate-500">Last ping</dt>
            <dd className="truncate font-medium">{timeAgoShort(monitor.lastPingAt, now)}</dd>
          </div>
        ) : (
          <div>
            <dt className="text-xs text-slate-500">Response</dt>
            <dd className="font-medium tabular-nums">{formatMs(monitor.lastResponseMs)}</dd>
          </div>
        )}
        <div className={heartbeat ? 'col-span-2' : undefined}>
          <dt className="text-xs text-slate-500">Interval</dt>
          <dd className="truncate font-medium">
            {heartbeat ? heartbeatIntervalLabel(monitor) : intervalLabel(monitor, now)}
          </dd>
        </div>
        {!heartbeat && (
          <div>
            <dt className="text-xs text-slate-500">Checked</dt>
            <dd className="truncate font-medium">{timeAgoShort(monitor.lastCheckedAt, now)}</dd>
          </div>
        )}
      </dl>
    </Link>
  );
}
