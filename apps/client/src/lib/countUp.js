/**
 * Pure maths for count-up animations. The easing is the same cubic bezier as
 * the --ease token, so numbers and CSS transitions move together.
 */

/** Returns a CSS-style cubic-bezier(x1, y1, x2, y2) easing: t (0..1) -> eased (0..1). */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s) => ((ay * s + by) * s + cy) * s;

  return (t) => {
    if (!(t > 0)) return 0;
    if (t >= 1) return 1;
    // Bisection on x: monotonic for the control points we use, and cheap enough per frame.
    let lo = 0;
    let hi = 1;
    let s = t;
    for (let i = 0; i < 24; i += 1) {
      const x = sampleX(s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

/** The --ease token: cubic-bezier(0.2, 0.7, 0.1, 1). */
export const easeOutSoft = cubicBezier(0.2, 0.7, 0.1, 1);

/** Linear progress 0..1 for `elapsed` ms of `duration` ms; a bad duration is "already done". */
export function progressAt(elapsed, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(1, elapsed / duration);
}

/** Value of a count from `from` to `to` after `elapsed` of `duration` ms, eased. */
export function countUpValue(from, to, elapsed, duration, easing = easeOutSoft) {
  const a = Number.isFinite(from) ? from : 0;
  if (!Number.isFinite(to)) return a;
  const p = progressAt(elapsed, duration);
  if (p >= 1) return to;
  return a + (to - a) * easing(p);
}
