import { cn } from '../../lib/cn.js';

const base =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-pill px-3.5 text-[13px] whitespace-nowrap transition-colors duration-200 ease-(--ease)';

/** Hairline pill (a tag, a filter chip). `active` fills it with the quiet surface. */
export function Pill({ active = false, as: Component = 'span', className, children, ...props }) {
  return (
    <Component
      className={cn(
        base,
        'border border-line',
        active ? 'bg-surface-2 text-fg' : 'text-muted',
        Component !== 'span' && 'hover:border-line-strong hover:text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

/**
 * Segmented control: options = [{ value, label }] (or plain strings).
 * The active segment sits on --surface-2.
 */
export function PillGroup({ options, value, onChange, label, className }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex rounded-pill border border-line p-0.5', className)}
    >
      {options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              base,
              'h-7 px-3',
              active ? 'bg-surface-2 text-fg' : 'text-faint hover:text-fg',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default PillGroup;
