import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMs } from '../../lib/format.js';
import AreaGradient from './AreaGradient.jsx';
import {
  axisProps,
  cursorProps,
  formatTick,
  gridProps,
  LINE_STROKE,
  LINE_WIDTH,
  niceTicks,
  svgId,
  tooltipBoxClasses,
} from './chartTheme.js';

/** A failed check (or bucket containing one): a status-down marker with a bg ring. */
function FailureDot({ cx, cy, payload }) {
  if (payload.ok || cx == null || cy == null) return null;
  return (
    <circle cx={cx} cy={cy} r={4} fill="var(--status-down)" stroke="var(--bg)" strokeWidth={2} />
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBoxClasses}>
      <p className="text-fg">{new Date(point.t).toLocaleString()}</p>
      <p className="mt-1">
        Response: <span className="font-mono text-fg tabular-nums">{formatMs(point.totalMs)}</span>
        {point.maxMs != null && <> (max {formatMs(point.maxMs)})</>}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-pill ${point.ok ? 'bg-status-up' : 'bg-status-down'}`}
        />
        {point.count
          ? `${point.count} checks · ${Math.round((point.upRatio ?? 1) * 100)}% passed`
          : point.ok
            ? 'Passed'
            : 'Failed'}
      </p>
    </div>
  );
}

/**
 * Response time over the selected range: one 1.5px line in the text colour
 * over a fading wash, failed checks marked with a ringed dot. Single series,
 * so no legend box: the card title names it.
 */
export default function ResponseTimeChart({ points, rangeMs }) {
  const id = svgId(useId(), 'rt');
  if (points.length === 0) {
    return <p className="py-16 text-center text-sm text-muted">No checks in this range yet.</p>;
  }
  // Failed checks have no response time; draw them on the baseline.
  const data = points.map((p) => ({ ...p, value: p.totalMs ?? 0 }));
  const ticks = niceTicks(Math.max(...data.map((p) => p.value), 1));
  const top = ticks[ticks.length - 1];

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <AreaGradient id={`${id}-area`} />
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="t"
            {...axisProps}
            tickFormatter={(value) => formatTick(value, rangeMs)}
            minTickGap={48}
          />
          <YAxis
            {...axisProps}
            width={52}
            tickFormatter={(ms) => formatMs(ms)}
            ticks={ticks}
            domain={[0, top]}
            interval={0}
          />
          <Tooltip content={<ChartTooltip />} cursor={cursorProps} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#${id}-area)`}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={LINE_STROKE}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={<FailureDot />}
            activeDot={{ r: 3.5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
