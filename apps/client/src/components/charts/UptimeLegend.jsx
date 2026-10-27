import { cn } from '../../lib/cn.js';
import { UPTIME_LEVELS } from '../../lib/uptimeLevels.js';

/** Explains the uptime bar colours, so colour is never the only cue. */
export default function UptimeLegend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
      {Object.entries(UPTIME_LEVELS).map(([key, level]) => (
        <li key={key} className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-pill', level.bar)} />
          {level.label}
          {key === 'good' && ' (≥ 99.9%)'}
          {key === 'degraded' && ' (≥ 99%)'}
        </li>
      ))}
    </ul>
  );
}
