import { cn } from '../../lib/cn.js';

// The dot carries the state; the label stays in the muted text colour.
const DOTS = {
  neutral: 'bg-status-paused',
  green: 'bg-status-up',
  red: 'bg-status-down',
  amber: 'bg-status-degraded',
  blue: 'bg-brand',
};

/** Dot + label. Tones keep their old names (green, red, amber, blue, neutral). */
export default function Badge({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-pill', DOTS[tone])} />
      {children}
    </span>
  );
}
