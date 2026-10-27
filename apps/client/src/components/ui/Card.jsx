import { cn } from '../../lib/cn.js';
import RingDot from './RingDot.jsx';

/**
 * Outline card: transparent fill, 1px hairline, 16px radius. `interactive`
 * adds the hover state (border to --line-strong, faint moss glow inside);
 * `ringDot` puts the signature icon top-right.
 */
export default function Card({
  className,
  interactive = false,
  ringDot = false,
  children,
  ...props
}) {
  return (
    <div
      className={cn(
        'relative rounded-card border border-line bg-surface transition-[border-color,box-shadow] duration-200 ease-(--ease) motion-reduce:transition-none',
        interactive && 'hover:border-line-strong hover:shadow-[inset_0_0_48px_-16px_var(--glow)]',
        className,
      )}
      {...props}
    >
      {ringDot && <RingDot className="absolute top-4 right-4" />}
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="font-medium text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
