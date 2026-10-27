import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import RingDot from './RingDot.jsx';

/**
 * The primary action style: ring-dot, a label and a 48px hairline arrow. On
 * hover (or focus) the line grows and the dot fills. Renders a router Link
 * with `to`, an anchor with `href`, otherwise a button.
 */
export default function RingDotCta({
  to,
  href,
  onClick,
  disabled = false,
  loading = false,
  type = 'button',
  className,
  children,
  ...props
}) {
  const inactive = disabled || loading;
  const classes = cn(
    'group inline-flex items-center gap-3 text-sm text-fg transition-colors duration-200 ease-(--ease) hover:text-brand focus-visible:text-brand',
    inactive && 'pointer-events-none opacity-50',
    className,
  );
  const content = (
    <>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-faint" aria-hidden="true" />
      ) : (
        <span className="relative inline-flex">
          <RingDot className="text-faint transition-colors duration-200 group-hover:text-fg group-focus-visible:text-fg" />
          {/* The dot fills on hover: a second, larger dot fades in over the small one. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 m-auto h-2.5 w-2.5 scale-50 rounded-pill bg-brand opacity-0 transition-[opacity,transform] duration-300 ease-(--ease) group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          />
        </span>
      )}
      <span>{children}</span>
      <span
        aria-hidden="true"
        className="relative h-px w-12 bg-current opacity-60 transition-[width,opacity] duration-300 ease-(--ease) group-hover:w-16 group-hover:opacity-100 group-focus-visible:w-16 group-focus-visible:opacity-100 motion-reduce:transition-none"
      >
        <span className="absolute top-1/2 right-0 h-1.5 w-1.5 -translate-y-1/2 rotate-45 border-t border-r border-current" />
      </span>
    </>
  );

  if (to && !inactive) {
    return (
      <Link to={to} className={classes} onClick={onClick} {...props}>
        {content}
      </Link>
    );
  }
  if (href && !inactive) {
    return (
      <a href={href} className={classes} onClick={onClick} {...props}>
        {content}
      </a>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={inactive}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </button>
  );
}
