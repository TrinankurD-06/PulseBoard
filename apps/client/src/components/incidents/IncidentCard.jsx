import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import { formatDuration, timeAgo } from '../../lib/format.js';
import Badge from '../ui/Badge.jsx';
import IncidentTimeline from './IncidentTimeline.jsx';

/** One incident: what broke, when, for how long; expands to show the timeline. */
export default function IncidentCard({ incident, wid, now, showMonitor = true }) {
  const [open, setOpen] = useState(false);
  const isOpen = !incident.resolvedAt;
  const durationSec = isOpen
    ? (now - new Date(incident.startedAt).getTime()) / 1000
    : incident.durationSec;

  return (
    <div
      className={cn(
        'rounded-xl border border-l-4 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60',
        isOpen
          ? 'border-l-red-500 dark:border-l-red-500'
          : 'border-l-emerald-500 dark:border-l-emerald-500',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isOpen ? <Badge tone="red">Ongoing</Badge> : <Badge tone="green">Resolved</Badge>}
            {showMonitor && incident.monitor && (
              <Link
                to={`/app/${wid}/monitors/${incident.monitor.id}`}
                className="font-medium hover:text-emerald-600 dark:hover:text-emerald-400"
              >
                {incident.monitor.name}
              </Link>
            )}
          </div>
          <p className="mt-1.5 text-sm break-words text-slate-600 dark:text-slate-400">
            {incident.cause}
          </p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Started</dt>
            <dd title={new Date(incident.startedAt).toLocaleString()}>
              {timeAgo(incident.startedAt, now)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{isOpen ? 'Down for' : 'Duration'}</dt>
            <dd className="tabular-nums">{formatDuration(durationSec)}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1 self-center text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          Timeline
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <IncidentTimeline events={incident.timeline} />
        </div>
      )}
    </div>
  );
}
