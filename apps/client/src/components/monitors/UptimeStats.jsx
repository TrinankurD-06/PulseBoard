import { uptimeLevel } from '@pulseboard/shared/uptime';
import { cn } from '../../lib/cn.js';
import Card from '../ui/Card.jsx';
import SampleBadge from '../ui/SampleBadge.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import { UPTIME_LEVELS as LEVELS } from '../../lib/uptimeLevels.js';

const WINDOWS = [
  ['h24', 'Last 24 hours'],
  ['d7', 'Last 7 days'],
  ['d30', 'Last 30 days'],
  ['d90', 'Last 90 days'],
];

/** Four stat tiles. The value stays in ink; a status dot + label carries the colour. */
export default function UptimeStats({ uptime }) {
  return (
    <div>
      {uptime?.includesSampleData && (
        <div className="mb-3 flex justify-end">
          <SampleBadge />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {WINDOWS.map(([key, label]) => {
          if (!uptime) return <Skeleton key={key} className="h-[120px] rounded-card" />;
          const value = uptime[key];
          const level = LEVELS[uptimeLevel(value)];
          return (
            <Card key={key} className="p-5">
              <p className="text-xs text-faint">{label}</p>
              <p className="mt-3 text-4xl leading-none font-light tracking-[-0.03em] text-fg tabular-nums">
                {value == null ? '—' : value}
                {value != null && <span className="ml-0.5 text-lg text-muted">%</span>}
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                <span className={cn('h-1.5 w-1.5 rounded-pill', level.bar)} />
                {level.label}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
