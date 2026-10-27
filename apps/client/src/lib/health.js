// Pure helpers for the Health deck: value and change formatting, the
// arrow/colour rule, selection fallback and keyboard index maths.
import { formatCount } from './format.js';

export const HEALTH_RANGES = ['1h', '24h', '7d'];
export const DEFAULT_HEALTH_RANGE = '24h';
export const RANGE_TEXT = { '1h': 'last hour', '24h': 'last 24h', '7d': 'last 7 days' };

const trimmed = (value, digits) => String(Number(value.toFixed(digits)));

/**
 * A metric value split into { text, unit } so the card can set the unit small:
 * 99.93 % · 182 ms · 1.42 s · 0.35 req/s · 1,204 pings. null is a dash.
 */
export function formatMetricValue(value, unit) {
  if (value == null || Number.isNaN(value)) return { text: '—', unit: '' };
  if (unit === 'ms') {
    return Math.abs(value) >= 1000
      ? { text: (value / 1000).toFixed(2), unit: 's' }
      : { text: value < 10 ? trimmed(value, 1) : String(Math.round(value)), unit: 'ms' };
  }
  if (unit === 'pings') return { text: formatCount(value), unit: value === 1 ? 'ping' : 'pings' };
  if (unit === '%') return { text: trimmed(value, 2), unit };
  if (unit === 'req/s') return { text: trimmed(value, 2), unit };
  return { text: trimmed(value, 2), unit: unit ?? '' };
}

/** "99.93%" as one string (tooltips, stats). */
export function formatMetricText(value, unit) {
  const { text, unit: u } = formatMetricValue(value, unit);
  if (!u) return text;
  return u === '%' ? `${text}%` : `${text} ${u}`;
}

// Direction only is neutral; these are the few cases where a direction is
// clearly bad, and only those get the "down" status colour:
//   - failed checks, missed pings and error rate rising
//   - uptime falling
// Nothing is ever coloured green: a good move is just quiet.
const WORSE_WHEN_UP = new Set(['failed', 'missed', 'errorRate']);
const WORSE_WHEN_DOWN = new Set(['uptime']);

/**
 * { text, arrow, direction, bad } for a % change vs the previous equal period.
 * null (no data to compare, or previous was 0) renders a neutral dash.
 */
export function formatChange(change, key) {
  if (change == null || Number.isNaN(change)) {
    return { text: '—', arrow: '', direction: 'none', bad: false };
  }
  const rounded = Math.round(Math.abs(change) * 10) / 10;
  if (rounded === 0) return { text: '0%', arrow: '', direction: 'flat', bad: false };
  const direction = change > 0 ? 'up' : 'down';
  const bad =
    (direction === 'up' && WORSE_WHEN_UP.has(key)) ||
    (direction === 'down' && WORSE_WHEN_DOWN.has(key));
  return {
    text: `${rounded}%`,
    arrow: direction === 'up' ? '↗' : '↘',
    direction,
    bad,
  };
}

/** Keep the selection while its key still exists, else fall back to the first. */
export function resolveSelection(keys, selected) {
  if (!keys.length) return null;
  return keys.includes(selected) ? selected : keys[0];
}

/**
 * Where a key press moves the selection in a group of `count` items, or null
 * when the key isn't a navigation key. Arrows wrap around.
 */
export function nextIndex(count, index, key) {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Y-axis domain for a series: padded around the data for %, from zero otherwise. */
export function seriesDomain(values, unit) {
  const present = values.filter((v) => v != null);
  if (!present.length) return [0, 1];
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  if (unit === '%') {
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    return [Math.max(0, lo - pad), Math.min(100, hi + pad)];
  }
  return [0, hi > 0 ? hi * 1.12 : 1];
}
