import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/** Filled cream pill; also used by links styled as primary buttons. */
export const primaryButtonClasses =
  'bg-brand text-brand-ink hover:bg-fg transition-colors duration-200 ease-(--ease)';

const VARIANTS = {
  primary: `${primaryButtonClasses} disabled:opacity-50 disabled:hover:bg-brand`,
  secondary:
    'border border-line-strong bg-transparent text-fg hover:border-fg hover:bg-surface-2 disabled:opacity-50',
  danger:
    'border border-status-down/60 bg-transparent text-status-down hover:bg-status-down hover:text-brand-ink disabled:opacity-50',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50',
};

const SIZES = { sm: 'h-8 px-3.5 text-[13px]', md: 'h-10 px-5 text-sm' };

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-pill font-medium whitespace-nowrap transition-[color,background-color,border-color] duration-200 ease-(--ease) disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
