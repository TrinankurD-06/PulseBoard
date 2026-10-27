import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/** Brand fill with a pressable 3D edge; also used by links styled as primary buttons. */
export const primaryButtonClasses = 'bg-brand-600 text-on-brand hover:bg-brand-700';

const VARIANTS = {
  primary: `${primaryButtonClasses} disabled:bg-brand-600/50`,
  secondary:
    'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-600/50',
  ghost:
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
};

const SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm' };

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
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed dark:focus-visible:ring-offset-black',
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
