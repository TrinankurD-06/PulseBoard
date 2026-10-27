import { forwardRef, useId } from 'react';
import { cn } from '../../lib/cn.js';

/** Bottom-border-only hairline input; focus turns the underline to the accent. */
export const inputClasses =
  'block w-full rounded-none border-0 border-b border-line-strong bg-transparent px-0 py-2 text-sm text-fg placeholder:text-faint transition-colors duration-200 focus:border-brand focus:shadow-[0_1px_0_0_var(--accent)] focus:outline-none disabled:opacity-50 aria-[invalid=true]:border-status-down';

/** Select: same underline, the native arrow replaced by a small chevron. */
const selectClasses = cn(
  inputClasses,
  'cursor-pointer appearance-none bg-[length:12px] bg-[right_2px_center] bg-no-repeat pr-6 [&>option]:bg-bg [&>option]:text-fg',
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%237c7b71' stroke-width='1.2'%3E%3Cpath d='M2 4.5l4 4 4-4'/%3E%3C/svg%3E\")]",
);

const textareaClasses = cn(inputClasses, 'min-h-20 resize-y leading-relaxed');

/**
 * Label + input + validation message. Works with React Hook Form's register():
 * <Field label="Email" error={errors.email?.message} {...register('email')} />
 * Pass `as="select"` or `as="textarea"` for those variants.
 */
const Field = forwardRef(function Field(
  { label, error, hint, as: Component = 'input', className, children, ...props },
  ref,
) {
  const id = useId();
  const messageId = `${id}-message`;
  const control =
    Component === 'select'
      ? selectClasses
      : Component === 'textarea'
        ? textareaClasses
        : inputClasses;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-xs text-faint">
          {label}
        </label>
      )}
      <Component
        id={id}
        ref={ref}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        className={control}
        {...props}
      >
        {children}
      </Component>
      {(error || hint) && (
        <p
          id={messageId}
          className={cn('mt-1.5 text-xs', error ? 'text-status-down' : 'text-faint')}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
});

export default Field;
