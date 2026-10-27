import { useId } from 'react';
import { sparkValue } from '../../lib/sparkline.js';
import { offlineBands, splitSegments } from '../../lib/segments.js';
import AreaGradient from './AreaGradient.jsx';
import { svgId } from './chartTheme.js';

const WIDTH = 120;
const HEIGHT = 32;
const PAD = 3;

/**
 * Tiny response-time trend for dashboard cards. Plain SVG rather than
 * Recharts: dozens render at once and update every few seconds, and a
 * polyline is far cheaper. Decorative inside a card that already shows the
 * numbers, so it carries a text summary instead of a tooltip. Drawn per
 * contiguous segment: a lone point is a dot, a gap draws nothing.
 */
export default function Sparkline({ points }) {
  const id = svgId(useId(), 'spark');
  if (!points || points.length < 2) {
    return <div className="h-8" aria-hidden="true" />;
  }

  const values = points.map(sparkValue);
  const max = Math.max(...values.filter((v) => v != null), 1);
  const x = (i) => PAD + (i / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (ms) => HEIGHT - PAD - (ms / max) * (HEIGHT - PAD * 2);
  const coord = (i) => `${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`;
  const segments = splitSegments(values);
  const bands = offlineBands(
    points.map((_, i) => x(i)),
    points.map((p) => p.state === 'unknown'),
  );
  const measured = values.filter((v) => v != null);
  const failures = points.filter((p) => p.state !== 'unknown' && !p.ok).length;
  const offline = points.filter((p) => p.state === 'unknown').length;
  const avg = measured.length
    ? Math.round(measured.reduce((sum, ms) => sum + ms, 0) / measured.length)
    : null;
  const summary = [
    `Last ${points.length} checks`,
    avg == null ? 'no response times' : `average ${avg}ms`,
    failures ? `${failures} failed` : null,
    offline ? `${offline} while the checker was offline` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role="img"
      aria-label={summary.replace(', ', ': ')}
    >
      <defs>
        <AreaGradient id={`${id}-area`} userSpace={{ top: PAD, bottom: HEIGHT - PAD }} />
      </defs>
      {bands.map((band, i) => (
        <rect
          key={`band-${i}`}
          x={band.x1}
          y={0}
          width={Math.max(band.x2 - band.x1, 1)}
          height={HEIGHT}
          fill="var(--text-faint)"
          fillOpacity="0.14"
        />
      ))}
      {segments.map(({ start, end }) => {
        if (end === start) {
          // A lone point: a round dot (a zero-length round-capped stroke keeps
          // its shape under the non-uniform scaling), no fill.
          return (
            <line
              key={start}
              x1={x(start)}
              x2={x(start)}
              y1={y(values[start])}
              y2={y(values[start])}
              stroke="var(--text)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        }
        const indices = Array.from({ length: end - start + 1 }, (_, k) => start + k);
        const line = indices.map(coord).join(' ');
        return (
          <g key={start}>
            <polyline
              points={`${x(start).toFixed(1)},${HEIGHT - PAD} ${line} ${x(end).toFixed(1)},${HEIGHT - PAD}`}
              fill={`url(#${id}-area)`}
              stroke="none"
            />
            <polyline
              points={line}
              fill="none"
              stroke="var(--text)"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}
