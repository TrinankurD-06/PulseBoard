import { useId } from 'react';
import Field from '../ui/Field.jsx';

/**
 * "Also add them to a status page": off, a new page, or one of the existing
 * pages. `value` is null or { mode: 'create', title } or { mode: 'extend', id }.
 */
export default function StatusPageOption({ value, onChange, pages = [], disabled }) {
  const checkId = useId();
  const enabled = value != null;
  const mode = value?.mode ?? 'create';

  const enable = (on) => {
    if (!on) return onChange(null);
    onChange({ mode: 'create', title: '' });
  };

  return (
    <div>
      <label htmlFor={checkId} className="flex cursor-pointer items-center gap-3 text-sm text-fg">
        <input
          id={checkId}
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => enable(event.target.checked)}
          className="h-4 w-4 cursor-pointer accent-brand"
        />
        Also add them to a status page
      </label>
      {enabled && (
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field
            as="select"
            label="Status page"
            value={mode === 'extend' ? value.id : 'new'}
            disabled={disabled}
            onChange={(event) =>
              event.target.value === 'new'
                ? onChange({ mode: 'create', title: '' })
                : onChange({ mode: 'extend', id: event.target.value })
            }
          >
            <option value="new">Create a new status page</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                Add to “{page.title}”
              </option>
            ))}
          </Field>
          {mode === 'create' && (
            <Field
              label="Title (optional)"
              placeholder="My projects"
              maxLength={80}
              value={value.title ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ mode: 'create', title: event.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}
