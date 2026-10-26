import { forwardRef, useId } from 'react';
import { cn } from '../../lib/cn.js';

export const inputClasses =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

/**
 * Label + input + validation message. Works with React Hook Form's register():
 * <Field label="Email" error={errors.email?.message} {...register('email')} />
 * Pass `as="select"` with <option> children for a select.
 */
const Field = forwardRef(function Field(
  { label, error, hint, as: Component = 'input', className, children, ...props },
  ref,
) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
          {label}
        </label>
      )}
      <Component
        id={id}
        ref={ref}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        className={cn(
          inputClasses,
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/30',
        )}
        {...props}
      >
        {children}
      </Component>
      {(error || hint) && (
        <p
          id={messageId}
          className={cn(
            'mt-1.5 text-xs',
            error ? 'text-red-600 dark:text-red-400' : 'text-slate-500',
          )}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
});

export default Field;
