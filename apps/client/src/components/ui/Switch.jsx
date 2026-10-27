import { cn } from '../../lib/cn.js';

/** Accessible on/off toggle (a button with role="switch"). */
export default function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
