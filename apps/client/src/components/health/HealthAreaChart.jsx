import { useId } from 'react';
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
import { formatMetricText, formatMetricValue, seriesDomain } from '../../lib/health.js';
import { axisProps, formatTick, gridProps } from '../charts/chartTheme.js';
import { svgId } from '../charts/heat.js';
import { isolatedDot } from './isolatedDot.jsx';
import { tooltipBox } from './tooltipStyles.js';

function SquareMarker({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return (
    <rect
      x={cx - 4}
      y={cy - 4}
      width={8}
      height={8}
      fill="var(--color-fg)"
      stroke="var(--color-surface)"
      strokeWidth={2}
    />
  );
}

function ChartTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBox}>
      <p className="text-muted">{new Date(point.t).toLocaleString()}</p>
      <p className="mt-0.5 font-mono text-fg">
        {point.v == null ? 'No data' : formatMetricText(point.v, unit)}
      </p>
    </div>
  );
}

/**
 * Large area chart for the selected metric: same look as the card sparkline
 * (light stroke, faint fill) with sparse time ticks, a hover crosshair and gaps
 * where a bucket has no data.
 */
export default function HealthAreaChart({ series, unit, range }) {
  const id = svgId(useId(), 'area');
  const domain = seriesDomain(
    series.map((p) => p.v),
    unit,
  );
  const ticks = (value) => formatMetricValue(value, unit).text;

  return (
    <div className="h-64" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={series}
          margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-fg)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-fg)" stopOpacity={0} />
            </linearGradient>
          </defs>
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
            domain={domain}
            tickCount={4}
            allowDecimals={unit !== 'pings'}
            tickFormatter={ticks}
          />
          <Tooltip
            content={<ChartTooltip unit={unit} />}
            cursor={{ stroke: 'var(--color-fg)', strokeOpacity: 0.35, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--color-fg)"
            strokeOpacity={0.8}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            connectNulls={false}
            dot={isolatedDot(series)}
            activeDot={<SquareMarker />}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
