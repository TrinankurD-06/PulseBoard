import { uptimeLevel } from '@pulseboard/shared/uptime';
import { useState } from 'react';
import { cn } from '../../lib/cn.js';
import { formatDuration } from '../../lib/format.js';
import { UPTIME_LEVELS as LEVELS } from '../../lib/uptimeLevels.js';

const formatDay = (date) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The classic status-page row: one thin bar per day (oldest left), coloured by
 * that day's uptime. Hover or keyboard focus shows date, uptime and downtime.
 * Used on the monitor page and the public status page.
 */
export default function UptimeBars({ days }) {
  const [active, setActive] = useState(null);
  const hovered = active == null ? null : days[active];

  return (
    <div className="relative">
      <div className="flex h-9 items-stretch gap-[3px]" role="list" aria-label="Daily uptime">
        {days.map((day, i) => {
          const level = LEVELS[uptimeLevel(day.uptime)];
          const description = `${formatDay(day.date)}: ${
            day.uptime == null ? 'no data' : `${day.uptime}% uptime`
          }`;
          return (
            <div
              key={day.date}
              role="listitem"
              tabIndex={0}
              aria-label={description}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              // The hit target is the whole column (incl. the 2px gap), not just the bar.
              className="group flex min-w-0 flex-1 cursor-default items-stretch focus-visible:outline-none"
            >
              <span
                className={cn(
                  'w-full rounded-pill transition-opacity group-hover:opacity-80 group-focus-visible:ring-[1.5px] group-focus-visible:ring-brand',
                  level.bar,
                )}
              />
            </div>
          );
        })}
      </div>

      {hovered && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-2 w-52 -translate-x-1/2 rounded-card border border-line-strong bg-bg/80 px-3.5 py-2.5 text-xs text-muted backdrop-blur-md"
          style={{
            left: `clamp(6.5rem, ${((active + 0.5) / days.length) * 100}%, calc(100% - 6.5rem))`,
          }}
          role="tooltip"
        >
          <p className="text-fg">{formatDay(hovered.date)}</p>
          <p className="mt-1 flex items-center gap-1.5">
            <span
              className={cn('h-1.5 w-1.5 rounded-pill', LEVELS[uptimeLevel(hovered.uptime)].bar)}
            />
            {LEVELS[uptimeLevel(hovered.uptime)].label}
          </p>
          {hovered.uptime != null && (
            <p className="mt-1 text-muted">
              {hovered.uptime}% uptime · {hovered.totalChecks.toLocaleString()} checks
              <br />
              Downtime: {hovered.downtimeSec ? formatDuration(hovered.downtimeSec) : 'none'}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{days.length} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}
