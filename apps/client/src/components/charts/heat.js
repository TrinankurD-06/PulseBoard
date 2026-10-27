// The yellow → orange → red "heat" ramp used by every chart (tokens in index.css).
const RAMP = [
  { at: 0, color: 'var(--color-heat-low)' },
  { at: 0.5, color: 'var(--color-heat-mid)' },
  { at: 1, color: 'var(--color-heat-high)' },
];

/** The ramp's colour at `fraction` (0–1), mixing the two neighbouring steps. */
export function heatColorAt(fraction) {
  const f = Math.min(Math.max(Number(fraction) || 0, 0), 1);
  const upper = RAMP.findIndex((step) => step.at >= f);
  if (RAMP[upper].at === f) return RAMP[upper].color;
  const lo = RAMP[upper - 1];
  const hi = RAMP[upper];
  const share = Math.round(((f - lo.at) / (hi.at - lo.at)) * 100);
  return `color-mix(in oklab, ${hi.color} ${share}%, ${lo.color})`;
}

const clamp01 = (value, fallback) => {
  const n = Number(value);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, 0), 1);
};

/**
 * Gradient stops for a shape whose bounding box spans the ramp positions
 * `from` (bottom) to `to` (top), each a value divided by the chart's top. So
 * colour follows the value itself: a line hovering near the top of the chart
 * is red, one near zero is yellow, however small its own wobble. Offsets run
 * bottom (0) → top (1).
 */
export function heatStops(from = 0, to = 1) {
  const start = clamp01(from, 0);
  const end = Math.max(clamp01(to, 1), start);
  if (end - start < 1e-6) return [{ offset: 0, color: heatColorAt(end) }];
  const span = end - start;
  return [
    { offset: 0, color: heatColorAt(start) },
    ...RAMP.filter((step) => step.at > start && step.at < end).map((step) => ({
      offset: Number(((step.at - start) / span).toFixed(4)),
      color: step.color,
    })),
    { offset: 1, color: heatColorAt(end) },
  ];
}

/**
 * Ramp positions of a line between `min` and `max` on an axis topping out at
 * `top`, or null when the line is flat: an objectBoundingBox gradient on a
 * zero-height shape isn't painted at all, so flat lines get a solid colour.
 */
export function lineHeat(min, max, top) {
  if (!(top > 0) || !(max - min > top * 1e-3)) return null;
  return { from: min / top, to: max / top };
}

/** An SVG-safe id from React's useId (which contains colons). */
export const svgId = (reactId, prefix) => `${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
