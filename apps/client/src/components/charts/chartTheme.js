// Recharts props shared by every chart: recessive solid hairline grid, quiet
// axes, and tick text in the axis token (never the series colour).
export const AXIS_TICK = {
  fill: 'var(--text-faint)',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};

export const gridProps = {
  stroke: 'var(--line)',
  strokeWidth: 1,
  vertical: false,
};

export const axisProps = {
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
};

export const tooltipBoxClasses =
  'rounded-card border border-line-strong bg-bg/80 px-3.5 py-2.5 text-xs text-muted backdrop-blur-md';

/** Hover cursor: a single hairline. */
export const cursorProps = { stroke: 'var(--line-strong)', strokeWidth: 1 };

/** Line series: 1.5px in the text colour; the area wash fades from 10% to nothing. */
export const LINE_STROKE = 'var(--text)';
export const LINE_WIDTH = 1.5;
export const AREA_TOP = 'color-mix(in oklab, var(--text) 10%, transparent)';
export const AREA_BOTTOM = 'transparent';

/** Tick label for a timestamp, appropriate to the visible range. */
export function formatTick(value, rangeMs) {
  const date = new Date(value);
  if (rangeMs > 2 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Round y-axis ticks from 0 that cover `max`: a 1/2/2.5/5 × 10^n step, so the
 * top tick is a round number (200/min, not 181.9/min). At most `count` steps.
 */
export function niceTicks(max, count = 4) {
  const top = Math.max(Number(max) || 0, 0);
  const target = top / count;
  let step = 1;
  if (target > 0) {
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const factor = [1, 2, 2.5, 5, 10].find((f) => f * magnitude >= target);
    step = factor * magnitude;
  }
  const steps = Math.max(1, Math.ceil(top / step - 1e-9));
  // Round away floating-point noise (0.30000000000000004).
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/** Width (px) a y-axis needs so its longest formatted tick label isn't clipped. */
export function yAxisWidth(labels, { charPx = 6.5, padding = 12, min = 40 } = {}) {
  const longest = Math.max(0, ...labels.map((label) => String(label).length));
  return Math.max(min, Math.ceil(longest * charPx) + padding);
}

/** An SVG-safe id from React's useId (which contains colons). */
export const svgId = (reactId, prefix) => `${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
