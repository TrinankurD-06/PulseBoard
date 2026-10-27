/**
 * Dot renderer for an Area: draws only buckets that sit alone between gaps,
 * because an area line has nothing to draw for a single point.
 */
export function isolatedDot(series, radius = 2) {
  return function IsolatedDot({ cx, cy, index }) {
    const point = series[index];
    if (cx == null || cy == null || point?.v == null) return null;
    if (series[index - 1]?.v != null || series[index + 1]?.v != null) return null;
    return <circle cx={cx} cy={cy} r={radius} fill="var(--text)" />;
  };
}
