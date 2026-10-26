import { formatMs } from '../../lib/format.js';
import { TIMING_PHASES } from '../../lib/timings.js';

/** One horizontal stacked bar: how long each network phase took. */
export default function TimingBar({ timings }) {
  const total = TIMING_PHASES.reduce((sum, phase) => sum + (timings[phase.key] ?? 0), 0);
  if (total <= 0) return null;

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="img"
        aria-label={TIMING_PHASES.map((p) => `${p.label} ${formatMs(timings[p.key])}`).join(', ')}
      >
        {TIMING_PHASES.map((phase) => {
          const value = timings[phase.key] ?? 0;
          if (value <= 0) return null;
          return (
            <div
              key={phase.key}
              style={{ width: `${(value / total) * 100}%`, backgroundColor: phase.color }}
              title={`${phase.label}: ${formatMs(value)}`}
            />
          );
        })}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
        {TIMING_PHASES.map((phase) => (
          <div key={phase.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: phase.color }} />
            <dt className="text-slate-500">{phase.label}</dt>
            <dd className="ml-auto font-medium tabular-nums sm:ml-0">
              {formatMs(timings[phase.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
