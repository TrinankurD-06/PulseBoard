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
import { useId } from 'react';
import { formatMs } from '../../lib/format.js';
import { axisProps, formatTick, gridProps, niceTicks, tooltipBoxClasses } from './chartTheme.js';
import { heatColorAt, lineHeat, svgId } from './heat.js';
import HeatGradient from './HeatGradient.jsx';

/** A failed check (or bucket containing one): red marker with a surface ring. */
function FailureDot({ cx, cy, payload }) {
  if (payload.ok || cx == null || cy == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--color-status-down)"
      stroke="var(--color-chart-surface)"
      strokeWidth={2}
    />
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBoxClasses}>
      <p className="font-medium">{new Date(point.t).toLocaleString()}</p>
      <p className="mt-1 text-slate-600 dark:text-slate-300">
        Response: <span className="font-medium tabular-nums">{formatMs(point.totalMs)}</span>
        {point.maxMs != null && <> (max {formatMs(point.maxMs)})</>}
      </p>
      <p className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${point.ok ? 'bg-status-up' : 'bg-status-down'}`} />
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
 * Response time over the selected range: one 2px line over a fading wash,
 * both on the yellow → red heat ramp (slow is red), failed checks marked with
 * a ringed dot. Single series, so no legend box: the card title names it.
 */
export default function ResponseTimeChart({ points, rangeMs }) {
  const id = svgId(useId(), 'rt');
  if (points.length === 0) {
    return <p className="py-16 text-center text-sm text-slate-500">No checks in this range yet.</p>;
  }
  // Failed checks have no response time; draw them on the baseline.
  const data = points.map((p) => ({ ...p, value: p.totalMs ?? 0 }));
  const values = data.map((p) => p.value);
  // Our own round ticks, so the ramp is measured against the axis the reader sees.
  const ticks = niceTicks(Math.max(...values, 1));
  const top = ticks[ticks.length - 1];
  const heat = lineHeat(Math.min(...values), Math.max(...values), top);
  const lineStroke = heat ? `url(#${id}-line)` : heatColorAt(Math.max(...values) / top);

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {heat && <HeatGradient id={`${id}-line`} from={heat.from} to={heat.to} />}
            <HeatGradient id={`${id}-area`} to={Math.max(...values) / top} fade />
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
            axisLine={false}
            width={52}
            tickFormatter={(ms) => formatMs(ms)}
            ticks={ticks}
            domain={[0, top]}
            interval={0}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: 'var(--color-chart-axis)', strokeWidth: 1 }}
          />
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
            stroke={lineStroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={<FailureDot />}
            activeDot={{ r: 4, stroke: 'var(--color-chart-surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
