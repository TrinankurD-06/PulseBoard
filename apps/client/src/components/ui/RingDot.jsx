import { cn } from '../../lib/cn.js';

/**
 * The signature icon: a thin ring with a small filled dot. 16px by default,
 * the dot in --accent, the ring in the current text colour. Decorative.
 */
export default function RingDot({ size = 16, filled = false, className }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0 text-faint', className)}
    >
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle
        cx="8"
        cy="8"
        r={filled ? 4.5 : 2}
        fill="var(--accent)"
        style={{ transition: 'r var(--dur-fast) var(--ease)' }}
      />
    </svg>
  );
}
