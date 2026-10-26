// Recharts props shared by every chart: recessive solid hairline grid, quiet
// axes, and tick text in the axis token (never the series colour).
export const AXIS_TICK = { fill: 'var(--color-chart-axis)', fontSize: 11 };

export const gridProps = {
  stroke: 'var(--color-chart-grid)',
  strokeWidth: 1,
  vertical: false,
};

export const axisProps = {
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: { stroke: 'var(--color-chart-grid)' },
};

export const tooltipBoxClasses =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900';

/** Tick label for a timestamp, appropriate to the visible range. */
export function formatTick(value, rangeMs) {
  const date = new Date(value);
  if (rangeMs > 2 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
