import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  axisProps,
  formatTick,
  gridProps,
  niceTicks,
  tooltipBoxClasses,
  yAxisWidth,
} from './chartTheme.js';
import { useId } from 'react';
import { heatColorAt, lineHeat, svgId } from './heat.js';
import HeatGradient from './HeatGradient.jsx';

function ChartTooltip({ active, payload, series, format }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBoxClasses}>
      <p className="font-medium">{new Date(point.t).toLocaleString()}</p>
      {series.map((s) => (
        <p
          key={s.key}
          className="mt-1 flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
        >
          {series.length > 1 && (
            <span className="h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
          )}
          {s.label}: <span className="font-medium tabular-nums">{format(point[s.key])}</span>
        </p>
      ))}
    </div>
  );
}

/** Legend for multi-series charts: a line swatch + label (dashes match the lines). */
function Legend({ series }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true">
            <line
              x1="0"
              y1="2"
              x2="16"
              y2="2"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dash}
            />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Time-series line chart for agent metrics. Series: [{ key, label, color,
 * dash? }]; thresholds: [{ value, label }] drawn as labelled dashed reference
 * lines (text, not only colour). Null values leave a gap (no traffic).
 */
export default function MetricLineChart({
  data,
  rangeMs,
  series,
  format,
  thresholds = [],
  emptyText = 'No reports in this range yet.',
}) {
  const id = svgId(useId(), 'metric');
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-slate-500">{emptyText}</p>;
  }
  const maxThreshold = Math.max(0, ...thresholds.map((t) => t.value));
  // Round ticks from our own domain (Recharts would label the raw maximum,
  // e.g. 181.9/min), and an axis wide enough for the longest label.
  const dataMax = Math.max(
    0,
    ...data.flatMap((row) => series.map((s) => row[s.key]).filter(Number.isFinite)),
  );
  const ticks = niceTicks(Math.max(dataMax, maxThreshold * 1.1));
  const width = yAxisWidth(ticks.map(format));
  // A single series follows the yellow → red heat ramp by value; several
  // series keep their own (ordered) ramp steps so they stay distinguishable.
  const top = ticks[ticks.length - 1];
  const singleValues =
    series.length === 1 ? data.map((row) => row[series[0].key]).filter(Number.isFinite) : [];
  const heat =
    singleValues.length > 0
      ? lineHeat(Math.min(...singleValues), Math.max(...singleValues), top)
      : null;
  const strokeOf = (s) => {
    if (series.length !== 1 || singleValues.length === 0) return s.color;
    return heat ? `url(#${id})` : heatColorAt(Math.max(...singleValues) / top);
  };

  return (
    <div>
      {series.length > 1 && <Legend series={series} />}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {heat && (
              <defs>
                <HeatGradient id={id} from={heat.from} to={heat.to} />
              </defs>
            )}
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
              width={width}
              tickFormatter={format}
              // The ticks include any threshold, so it stays visible even when
              // every value is far below it.
              ticks={ticks}
              domain={[0, ticks[ticks.length - 1]]}
              interval={0}
            />
            <Tooltip
              content={<ChartTooltip series={series} format={format} />}
              cursor={{ stroke: 'var(--color-chart-axis)', strokeWidth: 1 }}
            />
            {thresholds.map((t) => (
              <ReferenceLine
                key={t.label}
                y={t.value}
                stroke="var(--color-status-down)"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: t.label,
                  position: 'insideTopRight',
                  fill: 'var(--color-chart-axis)',
                  fontSize: 11,
                }}
                ifOverflow="extendDomain"
              />
            ))}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={strokeOf(s)}
                strokeWidth={2}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--color-chart-surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
