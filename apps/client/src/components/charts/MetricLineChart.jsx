import { useMemo } from 'react';
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
import { segmentSeries } from '../../lib/segments.js';
import {
  axisProps,
  cursorProps,
  formatTick,
  gridProps,
  niceTicks,
  LINE_WIDTH,
  tooltipBoxClasses,
  yAxisWidth,
} from './chartTheme.js';

function ChartTooltip({ active, payload, series, format }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBoxClasses}>
      <p className="text-fg">{new Date(point.t).toLocaleString()}</p>
      {series.map((s) => (
        <p key={s.key} className="mt-1 flex items-center gap-1.5 text-muted">
          {series.length > 1 && (
            <span className="h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
          )}
          {s.label}: <span className="font-mono text-fg tabular-nums">{format(point[s.key])}</span>
        </p>
      ))}
    </div>
  );
}

/** Legend for multi-series charts: a line swatch + label (dashes match the lines). */
function Legend({ series }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
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
 * lines (text, not only colour). Null values leave a gap (no traffic): each
 * contiguous run is its own line and a lone point is a small dot.
 */
export default function MetricLineChart({
  data,
  rangeMs,
  series,
  format,
  thresholds = [],
  emptyText = 'No reports in this range yet.',
}) {
  // One key per contiguous run of each series, so no line crosses a gap.
  const chart = useMemo(
    () =>
      series.reduce(
        (acc, s) => {
          // Each series adds its segment columns to the rows built so far.
          const out = segmentSeries(acc.rows, s.key, `${s.key}__`);
          return {
            rows: out.rows,
            layers: [...acc.layers, { series: s, lineKeys: out.lineKeys, dotKey: out.dotKey }],
          };
        },
        { rows: data, layers: [] },
      ),
    [data, series],
  );

  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-muted">{emptyText}</p>;
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

  return (
    <div>
      {series.length > 1 && <Legend series={series} />}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              cursor={cursorProps}
            />
            {thresholds.map((t) => (
              <ReferenceLine
                key={t.label}
                y={t.value}
                stroke="var(--status-down)"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: t.label,
                  position: 'insideTopRight',
                  fill: 'var(--text-faint)',
                  fontSize: 11,
                }}
                ifOverflow="extendDomain"
              />
            ))}
            {chart.layers.flatMap(({ series: s, lineKeys, dotKey }) => [
              ...lineKeys.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={LINE_WIDTH}
                  strokeDasharray={s.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  connectNulls={false}
                  dot={false}
                  activeDot={{ r: 3.5, stroke: 'var(--bg)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              )),
              ...(dotKey
                ? [
                    <Line
                      key={dotKey}
                      dataKey={dotKey}
                      name={s.label}
                      stroke="none"
                      dot={{ r: 2.5, fill: s.color, stroke: 'none' }}
                      activeDot={{ r: 3.5, stroke: 'var(--bg)', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />,
                  ]
                : []),
            ])}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
