import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import { formatDuration, timeAgo } from '../../lib/format.js';
import Badge from '../ui/Badge.jsx';
import CodeChip from '../ui/CodeChip.jsx';
import SampleBadge from '../ui/SampleBadge.jsx';
import IncidentTimeline from './IncidentTimeline.jsx';

// A soft red light on the left edge of an open incident (no hard border).
const OPEN_GLOW = {
  background:
    'radial-gradient(ellipse 60% 90% at 0% 50%, color-mix(in srgb, var(--status-down) 16%, transparent), transparent 100%)',
};

/** One incident row: what broke, when, for how long; expands to show the timeline. */
export default function IncidentCard({ incident, wid, now, showMonitor = true }) {
  const [open, setOpen] = useState(false);
  const isOpen = !incident.resolvedAt;
  const durationSec = isOpen
    ? (now - new Date(incident.startedAt).getTime()) / 1000
    : incident.durationSec;

  return (
    <div className="relative border-b border-line">
      {isOpen && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 max-w-md"
          style={OPEN_GLOW}
        />
      )}
      <div className="relative flex flex-wrap items-start gap-x-6 gap-y-3 px-1 py-5 sm:px-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {isOpen ? <Badge tone="red">Ongoing</Badge> : <Badge>Resolved</Badge>}
            {incident.isSeed && <SampleBadge />}
            {showMonitor && incident.monitor && (
              <Link
                to={`/app/${wid}/monitors/${incident.monitor.id}`}
                className={cn(
                  'transition-colors duration-200 hover:text-brand',
                  isOpen ? 'text-fg' : 'text-muted',
                )}
              >
                {incident.monitor.name}
              </Link>
            )}
          </div>
          <p
            className={cn(
              'mt-1.5 max-w-[60ch] text-sm break-words',
              isOpen ? 'text-muted' : 'text-faint',
            )}
          >
            {incident.causeCode && <CodeChip className="mr-2">{incident.causeCode}</CodeChip>}
            {incident.cause}
          </p>
        </div>
        <dl className="flex gap-8 text-sm">
          <div>
            <dt className="text-[11px] text-faint">Started</dt>
            <dd
              className={isOpen ? 'text-fg' : 'text-muted'}
              title={new Date(incident.startedAt).toLocaleString()}
            >
              {timeAgo(incident.startedAt, now)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-faint">{isOpen ? 'Down for' : 'Duration'}</dt>
            <dd className={cn('font-mono tabular-nums', isOpen ? 'text-fg' : 'text-muted')}>
              {formatDuration(durationSec)}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1 self-center text-sm text-faint transition-colors duration-200 hover:text-fg"
        >
          Timeline
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </div>
      {open && (
        <div className="relative px-1 pt-1 pb-6 sm:px-4">
          <IncidentTimeline events={incident.timeline} />
        </div>
      )}
    </div>
  );
}
