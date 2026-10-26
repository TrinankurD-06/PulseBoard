import { cn } from '../../lib/cn.js';
import { statusStyle } from '../../lib/status.js';

/**
 * Coloured status dot. Up and down monitors get a soft "pulse" ring to read as live.
 * Decorative: it is always shown next to a visible status label, so screen
 * readers skip it instead of announcing the status twice.
 */
export default function StatusDot({ status, size = 'md', className }) {
  const style = statusStyle(status);
  const dimensions = size === 'lg' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';
  const pulsing = status === 'up' || status === 'down';
  return (
    <span aria-hidden="true" className={cn('relative inline-flex shrink-0', dimensions, className)}>
      {pulsing && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-50',
            style.dot,
          )}
        />
      )}
      <span className={cn('relative inline-flex rounded-full', dimensions, style.dot)} />
    </span>
  );
}
