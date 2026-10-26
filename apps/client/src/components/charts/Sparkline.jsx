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

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role="img"
      aria-label={`Last ${points.length} checks: average ${avg}ms${failures ? `, ${failures} failed` : ''}`}
    >
      <polyline
        points={`${PAD},${HEIGHT - PAD} ${line} ${WIDTH - PAD},${HEIGHT - PAD}`}
        fill="var(--color-series-1)"
        fillOpacity="0.1"
        stroke="none"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-series-1)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
