import { Link } from 'react-router-dom';
import { intervalLabel } from '../../lib/budget.js';
import { formatMs, hostOf, timeAgoShort } from '../../lib/format.js';
import { statusStyle } from '../../lib/status.js';
import Sparkline from '../charts/Sparkline.jsx';
import StatusDot from './StatusDot.jsx';

export default function MonitorCard({ monitor, wid, now, sparkline }) {
  const style = statusStyle(monitor.status);
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
          <p className="truncate text-sm text-slate-500">{hostOf(monitor.url)}</p>
        </div>
        <span className={`text-sm font-medium ${style.text}`}>{style.label}</span>
      </div>
      <div className="mt-4">
        <Sparkline points={sparkline} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Response</dt>
          <dd className="font-medium tabular-nums">{formatMs(monitor.lastResponseMs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Interval</dt>
          <dd className="truncate font-medium">{intervalLabel(monitor, now)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Checked</dt>
          <dd className="truncate font-medium">{timeAgoShort(monitor.lastCheckedAt, now)}</dd>
        </div>
      </dl>
    </Link>
  );
}
