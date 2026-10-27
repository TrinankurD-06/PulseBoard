import { useState } from 'react';
import { cn } from '../../lib/cn.js';
import Card from '../ui/Card.jsx';
import SampleBadge from '../ui/SampleBadge.jsx';
import { PillGroup } from '../ui/Pill.jsx';

/**
 * Card wrapper for every chart, with a Chart/Table toggle. The table is the
 * accessible twin of the chart: every value is readable without hovering and
 * without relying on colour.
 *
 * sample: the chart includes demo-seed data, so the title carries a "Sample data" badge.
 * table: { columns: [{ key, label, align? }], rows: [{ key, ...cells }] }
 */
export default function ChartCard({ title, description, table, isRefreshing, sample, children }) {
  const [view, setView] = useState('chart');

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-light tracking-[-0.02em] text-fg">
            {title}
            {sample && <SampleBadge />}
          </h2>
          {description && <p className="mt-1 max-w-[38ch] text-sm text-muted">{description}</p>}
        </div>
        {table && (
          <PillGroup
            label="View"
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
            value={view}
            onChange={setView}
          />
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
  if (rows.length === 0) return <p className="text-sm text-muted">No data yet.</p>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-bg text-[11px] text-faint">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn('py-2 pr-4 font-normal', column.align === 'right' && 'text-right')}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'py-1.5 pr-4 text-muted',
                    column.align === 'right' && 'text-right font-mono tabular-nums',
                    column.mono && 'font-mono text-xs',
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
