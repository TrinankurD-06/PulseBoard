/**
 * Pure maths for TickGauge: tick geometry, filled-tick counting, clamping,
 * colour state and number formatting. No React, no DOM.
 */

export const TICK_COUNT = 60;

/** Value and max made safe: NaN/Infinity -> 0, a missing/invalid max -> 100, value clamped to 0..max. */
export function clampGauge(value, max = 100) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const v = Number.isFinite(value) ? value : 0;
  return { value: Math.min(Math.max(v, 0), safeMax), max: safeMax };
}

/** Filled fraction 0..1. */
export function gaugeFraction(value, max = 100) {
  const c = clampGauge(value, max);
  return c.value / c.max;
}

/**
 * How many of `count` ticks are lit. Rounded to the nearest tick, but a gauge
 * that is not empty always shows at least one tick and one that is not full
 * never shows all of them, so 99.98% does not read as 100%.
 */
export function filledTickCount(value, max = 100, count = TICK_COUNT) {
  const f = gaugeFraction(value, max);
  if (f <= 0) return 0;
  if (f >= 1) return count;
  return Math.min(count - 1, Math.max(1, Math.round(f * count)));
}

/** Angle of tick `index` in degrees: 0 at 12 o'clock, increasing clockwise. */
export function tickAngle(index, count = TICK_COUNT) {
  return (index / count) * 360;
}

/** Point at `radius` from (cx, cy) at `angleDeg` (0 = 12 o'clock, clockwise). SVG y points down. */
export function polarPoint(cx, cy, radius, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(a), y: cy - radius * Math.cos(a) };
}

/** Line endpoints of tick `index` between `rInner` and `rOuter`. */
export function tickLine(index, { cx, cy, rInner, rOuter, count = TICK_COUNT }) {
  const angle = tickAngle(index, count);
  const a = polarPoint(cx, cy, rInner, angle);
  const b = polarPoint(cx, cy, rOuter, angle);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, angle };
}

/**
 * 'ok' | 'down' | 'neutral'. Without a usable target the gauge is neutral.
 * 'above': the value must be at least the target; 'below': at most the target.
 * Equal to the target counts as meeting it.
 */
export function gaugeState({ value, target, direction = 'above' }) {
  if (!Number.isFinite(target) || !Number.isFinite(value)) return 'neutral';
  const missed = direction === 'below' ? value > target : value < target;
  return missed ? 'down' : 'ok';
}

/** Digits after the point when none are requested: whole numbers stay whole, otherwise up to 2. */
function autoDecimals(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? 0 : 2;
}

/**
 * Formats a number with fixed `decimals` (default: none for whole numbers, up
 * to 2 trimmed otherwise) and optional thousands separators. Non-finite -> '0'.
 */
export function formatGaugeNumber(value, { decimals, thousands = false } = {}) {
  const v = Number.isFinite(value) ? value : 0;
  const hasFixed = Number.isInteger(decimals) && decimals >= 0;
  let text;
  if (hasFixed) {
    text = v.toFixed(Math.min(decimals, 20));
  } else {
    text = v.toFixed(autoDecimals(v));
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  // "-0.00" from tiny negatives reads as noise.
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
  if (!thousands) return text;
  const [int, frac] = text.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** Screen-reader summary, e.g. "Uptime 99.98 percent, target 99.9, meeting target". */
export function gaugeSummary({
  label,
  value,
  unit = '%',
  target,
  direction = 'above',
  decimals,
  max = 100,
}) {
  const shown = formatGaugeNumber(value, { decimals, thousands: true });
  const unitWord = unit === '%' ? ' percent' : unit ? ` ${unit}` : '';
  let head = `${label ? `${label} ` : ''}${shown}${unitWord}`;
  if (Number.isFinite(max) && max !== 100)
    head += ` of ${formatGaugeNumber(max, { thousands: true })}`;
  const parts = [head];
  if (Number.isFinite(target)) {
    parts.push(`target ${formatGaugeNumber(target, { thousands: true })}`);
    parts.push(
      gaugeState({ value, target, direction }) === 'ok' ? 'meeting target' : 'missing target',
    );
  }
  return parts.join(', ');
}
