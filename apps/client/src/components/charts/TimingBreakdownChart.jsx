import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMs } from '../../lib/format.js';
import { TIMING_PHASES } from '../../lib/timings.js';
import { axisProps, gridProps, tooltipBoxClasses } from './chartTheme.js';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBoxClasses}>
      <p className="mb-1 text-fg">{new Date(point.t).toLocaleTimeString()}</p>
      {[...TIMING_PHASES].reverse().map((phase) => (
        <p key={phase.key} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-pill" style={{ backgroundColor: phase.color }} />
          <span className="text-faint">{phase.label}</span>
          <span className="ml-auto pl-3 font-mono text-fg tabular-nums">
            {formatMs(point[phase.key])}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Legend with each phase's average: identity never relies on colour alone. */
function Legend({ data }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {TIMING_PHASES.map((phase) => {
        const avg = data.reduce((sum, d) => sum + (d[phase.key] ?? 0), 0) / (data.length || 1);
        return (
          <li key={phase.key} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-pill" style={{ backgroundColor: phase.color }} />
            <span className="text-muted">{phase.label}</span>
            <span className="font-mono text-faint">avg {formatMs(avg)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Where the time of each recent check went: stacked DNS/TCP/TLS/TTFB/download.
 * Thin bars (max 10px) with a 2px background gap between segments; only the top
 * segment has the rounded data-end.
 */
export default function TimingBreakdownChart({ points }) {
  const data = points.filter((p) => p.timings).map((p) => ({ t: p.t, ...p.timings }));

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-muted">No successful checks yet.</p>;
  }

  return (
    <>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" hide />
            <YAxis
              {...axisProps}

              width={52}
              tickFormatter={(ms) => formatMs(ms)}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
            {TIMING_PHASES.map((phase, i) => (
              <Bar
                key={phase.key}
                dataKey={phase.key}
                stackId="timings"
                fill={phase.color}
                maxBarSize={10}
                stroke="var(--bg)"
                strokeWidth={2}
                radius={i === TIMING_PHASES.length - 1 ? [5, 5, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend data={data} />
    </>
  );
}
