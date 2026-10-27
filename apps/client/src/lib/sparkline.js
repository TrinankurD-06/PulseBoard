/**
 * The value drawn for a point: response time, or null for a gap. A check the
 * checker could not judge ('unknown') or a passed check without a time is a
 * gap; a failed check sits on the baseline.
 */
export function sparkValue(point) {
  if (point.state === 'unknown') return null;
  if (point.ms != null) return point.ms;
  return point.ok ? null : 0;
}
