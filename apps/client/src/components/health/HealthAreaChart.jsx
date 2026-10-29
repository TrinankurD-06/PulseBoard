import { useId } from 'react';
import { AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RANGES } from '../../api/analytics.js';
import {
  OFFLINE_LABEL,
  formatMetricText,
  formatMetricValue,
  seriesDomain,
} from '../../lib/health.js';
import { axisProps, formatTick, gridProps } from '../charts/chartTheme.js';
import { svgId } from '../charts/chartTheme.js';
import OfflineLegend from './OfflineLegend.jsx';
import { offlineBandLayers, segmentLayers, useGapSeries } from './gapLayers.jsx';
import { tooltipBox } from './tooltipStyles.js';

function RingMarker({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="var(--bg)" stroke="var(--text-faint)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={2.25} fill="var(--accent)" />
    </g>
  );
}

function ChartTooltip({ active, payload, unit, metricKey }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={tooltipBox}>
      <p className="text-muted">{new Date(point.t).toLocaleString()}</p>
      <p className={`mt-0.5 font-mono ${point.offline ? 'text-muted' : 'text-fg'}`}>
        {point.offline
          ? OFFLINE_LABEL
          : point.v == null
            ? 'No data'
            : formatMetricText(point.v, unit, metricKey)}
      </p>
    </div>
  );
}

/**
 * Large area chart for the selected metric: same look as the card sparkline
 * (light stroke, faint fill) with sparse time ticks, a hover crosshair and gaps
 * where a bucket has no data.
 */
export default function HealthAreaChart({ series, unit, metricKey, range }) {
  const id = svgId(useId(), 'area');
  const gaps = useGapSeries(series);
  const domain = seriesDomain(
    series.map((p) => p.v),
    unit,
  );
  const ticks = (value) => formatMetricValue(value, unit, metricKey).text;

  return (
    <div>
      {gaps.hasOffline && <OfflineLegend />}
      <div className="h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={gaps.rows}
            margin={{ top: 12, right: 32, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--series)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
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
              content={<ChartTooltip unit={unit} metricKey={metricKey} />}
              cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {offlineBandLayers(gaps.bands)}
            {segmentLayers({
              ...gaps,
              gradientId: id,
              activeDot: <RingMarker />,
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
