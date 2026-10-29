import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RANGES } from '../../api/analytics.js';
import { formatMs } from '../../lib/format.js';
import { TIMING_PHASES } from '../../lib/timings.js';
import { axisProps, formatTick, gridProps } from '../charts/chartTheme.js';
import { tooltipBox } from './tooltipStyles.js';

const sum = (point) => TIMING_PHASES.reduce((total, phase) => total + (point[phase.key] ?? 0), 0);

function TimingTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const has = TIMING_PHASES.some((phase) => point[phase.key] != null);
  return (
    <div className={tooltipBox}>
      <p className="text-muted">{new Date(point.t).toLocaleString()}</p>
      {has ? (
        <>
          {[...TIMING_PHASES].reverse().map((phase) => (
            <p key={phase.key} className="mt-0.5 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: phase.color }}
                aria-hidden="true"
              />
              <span className="text-muted">{phase.label}</span>
              <span className="ml-auto pl-3 font-mono">{formatMs(point[phase.key])}</span>
            </p>
          ))}
          <p className="mt-1 flex border-t border-line pt-1 font-mono">
            <span className="text-muted">Total</span>
            <span className="ml-auto pl-3">{formatMs(sum(point))}</span>
          </p>
        </>
      ) : (
        <p className="mt-0.5 font-mono">No data</p>
      )}
    </div>
  );
}

/** Stacked areas of DNS / TCP / TLS / TTFB / download in shades of the text colour, with a legend of averages. */
export default function TimingChart({ timings, range }) {
  const avg = (key) => {
    const present = timings.filter((p) => p[key] != null);
    return present.length ? present.reduce((a, p) => a + p[key], 0) / present.length : null;
  };

  return (
    <div>
      <div className="h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={timings}
            margin={{ top: 12, right: 32, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="t"
              {...axisProps}
              tickFormatter={(value) => formatTick(value, RANGES[range])}
              minTickGap={56}
            />
            <YAxis
              {...axisProps}
              axisLine={false}
              width={44}
              tickFormatter={(ms) => formatMs(ms)}
            />
            <Tooltip
              content={<TimingTooltip />}
              cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {TIMING_PHASES.map((phase) => (
              <Area
                key={phase.key}
                type="monotone"
                dataKey={phase.key}
                stackId="timings"
                stroke="var(--bg)"
                strokeWidth={1}
                fill={phase.color}
                fillOpacity={0.9}
                connectNulls={false}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {TIMING_PHASES.map((phase) => (
          <li key={phase.key} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: phase.color }}
              aria-hidden="true"
            />
            <span className="text-fg">{phase.label}</span>
            <span className="font-mono text-muted">avg {formatMs(avg(phase.key))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
