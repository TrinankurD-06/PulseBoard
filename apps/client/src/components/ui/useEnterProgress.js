import { useEffect, useState } from 'react';
import { easeOutSoft, progressAt } from '../../lib/countUp.js';

/** True when the user asked for less motion. Safe without matchMedia (tests, old browsers). */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Eased progress 0 -> 1 that runs once after mount (`duration` ms, the --ease
 * curve) and then stays at 1. Starts and stays at 1 under reduced motion.
 */
export default function useEnterProgress(duration = 800) {
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0));

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let frame = 0;
    let start = null;
    const tick = (now) => {
      if (start === null) start = now;
      const p = progressAt(now - start, duration);
      setProgress(easeOutSoft(p));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration]);

  return progress;
}
