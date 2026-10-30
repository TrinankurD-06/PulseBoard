import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useAdminUsers, useAdminWorkspaces } from '../../api/admin.js';
import { cn } from '../../lib/cn.js';
import Field, { inputClasses } from '../ui/Field.jsx';

/** The row that holds a list's filters. */
export function FilterBar({ children }) {
  return (
    <div className="grid grid-cols-2 items-end gap-x-4 gap-y-4 border-b border-line px-5 py-4 sm:flex sm:flex-wrap sm:gap-x-6">
      {children}
    </div>
  );
}

/**
 * A search box that tells the page what was typed 300 ms after the last keystroke. It follows
 * `value` when the page changes it from outside (a cleared filter, a link).
 */
export function SearchBox({ label, value, onSearch, placeholder, className }) {
  const [input, setInput] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setInput(value);
  }

  const latest = useRef(onSearch);
  useEffect(() => {
    latest.current = onSearch;
  });
  useEffect(() => {
    if (input.trim() === value) return undefined;
    const id = setTimeout(() => latest.current(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input, value]);

  const id = useId();
  return (
    <div
      className={cn(
        'col-span-2 min-w-0 sm:col-span-1 sm:flex-1 sm:basis-56 sm:max-w-xs',
        className,
      )}
    >
      <label htmlFor={id} className="block text-xs text-faint">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <input
          id={id}
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder}
          className={cn(inputClasses, 'pl-6')}
        />
      </div>
    </div>
  );
}

/** A labelled drop-down. `options`: [{ value, label }]. */
export function SelectFilter({ label, value, onChange, options, className }) {
  return (
    <Field
      as="select"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className ?? 'w-full sm:w-40'}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Field>
  );
}

export function DateFilter({ label, value, onChange }) {
  return (
    <Field
      type="date"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full sm:w-40"
    />
  );
}

/** A tick box for a yes/no filter ("Failing now"). */
export function ToggleFilter({ label, checked, onChange }) {
  return (
    <label className="col-span-2 flex h-9 cursor-pointer sm:col-span-1 items-center gap-2 text-sm text-muted select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer rounded-sm accent-(--accent)"
      />
      {label}
    </label>
  );
}

const KINDS = {
  users: {
    useRows: (params, options) => useAdminUsers(params, options),
    primary: (row) => row.name,
    secondary: (row) => row.email,
  },
  workspaces: {
    useRows: (params, options) => useAdminWorkspaces(params, options),
    primary: (row) => row.name,
    secondary: (row) => row.owner?.email ?? row.slug,
  },
};

/**
 * Type to search, pick one. Shows a short list of matches under the box; `excludeId` hides
 * one row (the user being deleted can't take over their own workspaces).
 */
export function EntityPicker({ kind, label, placeholder, onPick, excludeId, autoFocus }) {
  const { useRows, primary, secondary } = KINDS[kind];
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(input.trim()), 250);
    return () => clearTimeout(id);
  }, [input]);

  const { data, isFetching, isError } = useRows({ search, limit: 6 }, { enabled: search !== '' });
  const rows = (data?.data ?? []).filter((row) => row.id !== excludeId);
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-xs text-faint">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={input}
        autoFocus={autoFocus}
        onChange={(event) => setInput(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClasses}
      />
      <div aria-live="polite">
        {search !== '' && isError && (
          <p className="mt-2 text-xs text-status-down">Couldn&apos;t search.</p>
        )}
        {search !== '' && !isError && !isFetching && rows.length === 0 && (
          <p className="mt-2 text-xs text-faint">No matches.</p>
        )}
      </div>
      {search !== '' && rows.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-card border border-line">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  onPick(row);
                  setInput('');
                  setSearch('');
                }}
                className="block w-full px-3 py-2 text-left transition-colors hover:bg-surface-2"
              >
                <span className="block truncate text-sm text-fg">{primary(row)}</span>
                <span className="block truncate text-xs text-faint">{secondary(row)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A filter by one user or workspace: a search that, once picked, becomes a chip with a
 * remove button. `value` is `{ id, name }` or null.
 */
export function EntityFilter({ kind, label, value, onChange }) {
  if (value?.id) {
    return (
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="text-xs text-faint">{label}</p>
        <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-pill border border-line-strong py-1 pr-1 pl-3 text-[13px] text-fg">
          <span className="truncate">{value.name || value.id}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            className="rounded-pill p-1 text-faint transition-colors hover:text-fg"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="w-full sm:w-52">
      <EntityPicker
        kind={kind}
        label={label}
        placeholder={kind === 'users' ? 'Name or email' : 'Workspace name'}
        onPick={(row) => onChange({ id: row.id, name: row.name })}
      />
    </div>
  );
}
