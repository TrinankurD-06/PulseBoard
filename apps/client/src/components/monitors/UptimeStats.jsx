import { uptimeLevel } from '@pulseboard/shared/uptime';
import { cn } from '../../lib/cn.js';
import Card from '../ui/Card.jsx';
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
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {WINDOWS.map(([key, label]) => {
        if (!uptime) return <Skeleton key={key} className="h-[92px] rounded-xl" />;
        const value = uptime[key];
        const level = LEVELS[uptimeLevel(value)];
        return (
          <Card key={key} className="p-4">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value == null ? '—' : `${value}%`}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <span className={cn('h-2 w-2 rounded-full', level.bar)} />
              {level.label}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
