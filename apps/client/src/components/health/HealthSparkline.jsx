import { useId } from 'react';
import { AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { OFFLINE_LABEL, formatMetricText, seriesDomain } from '../../lib/health.js';
import { svgId } from '../charts/chartTheme.js';
import { offlineBandLayers, segmentLayers, useGapSeries } from './gapLayers.jsx';
import { tooltipBox } from './tooltipStyles.js';

function RingMarker({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="var(--bg)" stroke="var(--text-faint)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={2.25} fill="var(--accent)" />
    </g>
  );
}

function SparkTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.v == null && !point.offline) return null;
  return (
    <div className={`${tooltipBox} font-mono text-[11px] whitespace-nowrap`}>
      <span className="text-muted">
        {new Date(point.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </span>{' '}
      <span className={point.offline ? 'text-muted' : 'text-fg'}>
        {point.offline ? OFFLINE_LABEL : formatMetricText(point.v, unit)}
      </span>
    </div>
  );
}

/**
 * Decorative area sparkline: fills its (absolutely positioned) parent edge to
 * edge. 1.25px light stroke, faint gradient, no axes or grid. Hovering draws a
 * crosshair, a ring-dot marker and a small tooltip. aria-hidden: the card's text
 * carries the value.
 */
export default function HealthSparkline({ series, unit }) {
  const id = svgId(useId(), 'spark');
  const gaps = useGapSeries(series);
  const domain = seriesDomain(
    series.map((p) => p.v),
    unit,
  );
  // A little headroom under the line so the stroke never sits on the edge.
  const span = domain[1] - domain[0] || 1;
  const yDomain = [domain[0] - span * 0.12, domain[1]];

  return (
    <div aria-hidden="true" className="absolute inset-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={gaps.rows}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--text)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
          <YAxis hide domain={yDomain} />
          <Tooltip
            content={<SparkTooltip unit={unit} />}
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
            position={{ y: 2 }}
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
  );
}
