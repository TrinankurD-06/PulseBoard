import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn.js';
import { paginationText, pageCount, selectionState } from '../../lib/adminConsole.js';
import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { LoadingRows } from './AdminBits.jsx';

const checkboxClasses = 'h-4 w-4 cursor-pointer rounded-sm border-line-strong accent-(--accent)';

/** The header checkbox: a native checkbox whose "some selected" state is set on the DOM node. */
function PageCheckbox({ state, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      onChange={onChange}
      className={checkboxClasses}
    />
  );
}

/**
 * A table on wide screens and a stack of small cards on phones (so nothing scrolls
 * sideways). `columns`: [{ key, header, cell(row), primary?, className?, mobile?(row) }].
 * The `primary` column is the title of a phone card; `mobile` swaps in a different cell
 * for the phone card (used for rows whose actions need text labels there).
 * Selection: pass `selected` (a Set of ids), `onToggleRow(id)`, `onTogglePage()` and
 * `selectLabel(row)` for the checkbox's accessible name.
 */
export default function DataTable({
  columns,
  rows,
  caption,
  isPending = false,
  isFetching = false,
  isError = false,
  errorText = "Couldn't load this list.",
  empty = { title: 'Nothing here', description: 'Try a different filter.' },
  selected,
  onToggleRow,
  onTogglePage,
  selectLabel = () => 'Select row',
}) {
  const selectable = Boolean(selected);

  if (isPending) return <LoadingRows rows={5} />;
  if (isError) {
    return (
      <p role="alert" className="p-5 text-sm text-status-down">
        {errorText}
      </p>
    );
  }
  if (!rows?.length) {
    return (
      <div className="p-5">
        <EmptyState title={empty.title} description={empty.description} />
      </div>
    );
  }

  const primary = columns.find((column) => column.primary) ?? columns[0];
  const others = columns.filter((column) => column !== primary);

  return (
    <div className={cn('transition-opacity', isFetching && 'opacity-60')} aria-busy={isFetching}>
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="text-[11px] text-faint">
            <tr className="border-b border-line">
              {selectable && (
                <th scope="col" className="w-10 py-3 pr-2 pl-5">
                  <PageCheckbox
                    state={selectionState(rows, selected)}
                    onChange={onTogglePage}
                    label="Select all rows on this page"
                  />
                </th>
              )}
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'py-3 pr-4 font-normal',
                    index === 0 && !selectable && 'pl-5',
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'align-top transition-colors hover:bg-surface-2',
                  selectable && selected.has(row.id) && 'bg-surface-2',
                )}
              >
                {selectable && (
                  <td className="py-3 pr-2 pl-5">
                    <input
                      type="checkbox"
                      aria-label={selectLabel(row)}
                      checked={selected.has(row.id)}
                      onChange={() => onToggleRow(row.id)}
                      className={checkboxClasses}
                    />
                  </td>
                )}
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      'py-3 pr-4 text-muted',
                      index === 0 && !selectable && 'pl-5',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-3 px-5 py-4">
            <div className="flex items-start gap-3">
              {selectable && (
                <input
                  type="checkbox"
                  aria-label={selectLabel(row)}
                  checked={selected.has(row.id)}
                  onChange={() => onToggleRow(row.id)}
                  className={cn(checkboxClasses, 'mt-0.5 shrink-0')}
                />
              )}
              <div className="min-w-0 flex-1 text-sm text-fg">{primary.cell(row)}</div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {others.map((column) => (
                <div key={column.key} className={cn('min-w-0', column.wide && 'col-span-2')}>
                  <dt className="text-[11px] text-faint">{column.header}</dt>
                  <dd className="mt-0.5 break-words text-muted">
                    {(column.mobile ?? column.cell)(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Showing 1–25 of 132" and Previous / Next. Renders nothing for an empty list. */
export function Pagination({ pagination, page, limit, onPage }) {
  const total = pagination?.total ?? 0;
  if (!total) return null;
  const pages = pageCount(total, limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
      <span aria-live="polite">
        {paginationText({ page, limit, total })}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </span>
      {pages > 1 && (
        <span className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </span>
      )}
    </div>
  );
}
