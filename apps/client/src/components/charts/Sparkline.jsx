import { useId } from 'react';
import { svgId } from './heat.js';
import HeatGradient from './HeatGradient.jsx';

const WIDTH = 120;
const HEIGHT = 32;
const PAD = 3;

/**
 * Tiny response-time trend for dashboard cards. Plain SVG rather than
 * Recharts: dozens render at once and update every few seconds, and a
 * polyline is far cheaper. Decorative inside a card that already shows the
 * numbers, so it carries a text summary instead of a tooltip.
 */
export default function Sparkline({ points }) {
  const id = svgId(useId(), 'spark');
  if (!points || points.length < 2) {
    return <div className="h-8" aria-hidden="true" />;
  }

  const values = points.map((p) => p.ms ?? 0);
  const max = Math.max(...values, 1);
  const x = (i) => PAD + (i / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (ms) => HEIGHT - PAD - (ms / max) * (HEIGHT - PAD * 2);
  const line = values.map((ms, i) => `${x(i).toFixed(1)},${y(ms).toFixed(1)}`).join(' ');
  const failures = points.filter((p) => !p.ok).length;
  const avg = Math.round(values.reduce((sum, ms) => sum + ms, 0) / values.length);
  // Pinned to the plot (0 at the bottom, the max at the top), so a flat line
  // still gets a colour and spikes turn red.
  const plot = { bottom: HEIGHT - PAD, top: PAD };

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role="img"
      aria-label={`Last ${points.length} checks: average ${avg}ms${failures ? `, ${failures} failed` : ''}`}
    >
      <defs>
        <HeatGradient id={`${id}-line`} userSpace={plot} />
        <HeatGradient id={`${id}-area`} userSpace={plot} fade />
      </defs>
      <polyline
        points={`${PAD},${HEIGHT - PAD} ${line} ${WIDTH - PAD},${HEIGHT - PAD}`}
        fill={`url(#${id}-area)`}
        stroke="none"
      />
      <polyline
        points={line}
        fill="none"
        stroke={`url(#${id}-line)`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
