import { cn } from '../../lib/cn.js';

/** Accessible on/off toggle (a button with role="switch"): hairline track, cream dot when on. */
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
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors duration-200 ease-(--ease) disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-brand bg-brand/15' : 'border-line-strong bg-transparent',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-pill transition-[transform,background-color] duration-200 ease-(--ease) motion-reduce:transition-none',
          checked ? 'translate-x-6 bg-brand' : 'translate-x-1 bg-faint',
        )}
      />
    </button>
  );
}
