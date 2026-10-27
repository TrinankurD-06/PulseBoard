import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMetricText, seriesDomain } from '../../lib/health.js';
import { svgId } from '../charts/chartTheme.js';
import { isolatedDot } from './isolatedDot.jsx';
import { tooltipBox } from './tooltipStyles.js';

function SquareMarker({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return (
    <rect
      x={cx - 3.5}
      y={cy - 3.5}
      width={7}
      height={7}
      fill="var(--color-fg)"
      stroke="var(--color-surface-2)"
      strokeWidth={1.5}
    />
  );
}

function SparkTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.v == null) return null;
  return (
    <div className={`${tooltipBox} font-mono text-[11px] whitespace-nowrap`}>
      <span className="text-muted">
        {new Date(point.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </span>{' '}
      <span className="text-fg">{formatMetricText(point.v, unit)}</span>
    </div>
  );
}

/**
 * Decorative area sparkline: fills its (absolutely positioned) parent edge to
 * edge. 1.5px light stroke, faint gradient, no axes or grid. Hovering draws a
 * crosshair, a square marker and a small tooltip. aria-hidden: the card's text
 * carries the value.
 */
export default function HealthSparkline({ series, unit }) {
  const id = svgId(useId(), 'spark');
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
          data={series}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-fg)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--color-fg)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis hide domain={yDomain} />
          <Tooltip
            content={<SparkTooltip unit={unit} />}
            cursor={{ stroke: 'var(--color-fg)', strokeOpacity: 0.35, strokeWidth: 1 }}
            position={{ y: 2 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--color-fg)"
            strokeOpacity={0.75}
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
