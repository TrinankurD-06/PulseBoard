import { useState } from 'react';
import { cn } from '../../lib/cn.js';
import { formatDuration } from '../../lib/format.js';

/**
 * One thin bar per ping or missed period, oldest left. Green = ping received,
 * red = missed or failed; each bar also has a text label (tooltip, aria) so
 * colour is never the only cue. Bar height shows the run duration when the
 * job used /start, relative to the longest run.
 */
export default function PingHistoryChart({ entries }) {
  const [active, setActive] = useState(null);
  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">No pings yet.</p>;
  }
  const longest = Math.max(0, ...entries.map((e) => e.durationMs ?? 0));
  const hovered = active == null ? null : entries[active];

  return (
    <div className="relative">
      <div className="flex h-20 items-end gap-[2px]" role="list" aria-label="Ping history">
        {entries.map((entry, i) => {
          const height =
            entry.ok && longest > 0 && entry.durationMs != null
              ? Math.max(25, (entry.durationMs / longest) * 100)
              : 100;
          const when = new Date(entry.t).toLocaleString();
          return (
            <div
              key={`${entry.t}-${i}`}
              role="listitem"
              tabIndex={0}
              aria-label={`${when}: ${entry.label}${entry.durationMs != null ? `, run took ${formatDuration(entry.durationMs / 1000)}` : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
            >
              <span
                className={cn(
                  'w-full rounded-t-[2px] transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-emerald-500',
                  entry.ok ? 'bg-status-up' : 'bg-status-down',
                )}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>

      {hovered && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-2 w-48 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{
            left: `clamp(6rem, ${((active + 0.5) / entries.length) * 100}%, calc(100% - 6rem))`,
          }}
          role="tooltip"
        >
          <p className="font-medium">{new Date(hovered.t).toLocaleString()}</p>
          <p className="mt-1 flex items-center gap-1.5">
            <span
              className={cn('h-2 w-2 rounded-full', hovered.ok ? 'bg-status-up' : 'bg-status-down')}
            />
            {hovered.label}
          </p>
          {hovered.durationMs != null && (
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              Run took {formatDuration(hovered.durationMs / 1000)}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>Oldest</span>
        <span>Latest</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-status-up" /> Ping received
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-status-down" /> Missed or failed
        </li>
        {longest > 0 && <li>Bar height: run duration (jobs using /start)</li>}
      </ul>
    </div>
  );
}
