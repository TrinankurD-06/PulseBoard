import { useState } from 'react';
import { cn } from '../../lib/cn.js';
import Card from '../ui/Card.jsx';

/**
 * Card wrapper for every chart, with a Chart/Table toggle. The table is the
 * accessible twin of the chart: every value is readable without hovering and
 * without relying on colour.
 *
 * table: { columns: [{ key, label, align? }], rows: [{ key, ...cells }] }
 */
export default function ChartCard({ title, description, table, isRefreshing, children }) {
  const [view, setView] = useState('chart');

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {table && (
          <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs dark:border-slate-800">
            {['chart', 'table'].map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={cn(
                  'rounded px-2.5 py-1 capitalize',
                  view === option
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hold the previous render (dimmed) while refetching: no skeleton flash. */}
      <div className={cn('p-5 transition-opacity', isRefreshing && 'opacity-60')}>
        {view === 'table' && table ? <DataTable {...table} /> : children}
      </div>
    </Card>
  );
}

function DataTable({ columns, rows }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No data yet.</p>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-white text-xs text-slate-500 dark:bg-slate-900">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn('py-2 pr-4 font-medium', column.align === 'right' && 'text-right')}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'py-1.5 pr-4',
                    column.align === 'right' && 'text-right tabular-nums',
                  )}
                >
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
