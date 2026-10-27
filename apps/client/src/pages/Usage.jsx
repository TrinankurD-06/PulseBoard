import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWorkspaceUsage } from '../api/usage.js';
import BudgetMeter from '../components/monitors/BudgetMeter.jsx';
import StatusBadge from '../components/monitors/StatusBadge.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClasses } from '../components/ui/Field.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import { cn } from '../lib/cn.js';
import { formatCount, formatCurrency, formatMonth } from '../lib/format.js';
import {
  byTypeSentence,
  costValue,
  monitorTypeLabel,
  monthOf,
  monthOptions,
  nextSort,
  sortUsageRows,
  usageBudget,
  usageInterval,
} from '../lib/usage.js';

function Tile({ label, value, hint }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function CostTile({ totals, isCurrentMonth }) {
  const costs = totals.costByCurrency ?? [];
  if (costs.length === 0) {
    return (
      <Tile
        label="Cost"
        value={<span className="text-base font-normal text-slate-500">No prices set</span>}
        hint="Add a price per 1,000 requests when editing a monitor."
      />
    );
  }
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">{isCurrentMonth ? 'Cost so far' : 'Cost'}</p>
      <ul className="mt-2 space-y-1">
        {costs.map((c) => (
          <li key={c.currency}>
            <span className="text-2xl font-semibold tabular-nums">
              {formatCurrency(c.actual, c.currency)}
            </span>
            {isCurrentMonth && (
              <span className="ml-2 text-xs text-slate-500">
                ≈ {formatCurrency(c.estimatedMonthly, c.currency)} / month
              </span>
            )}
          </li>
        ))}
      </ul>
      {costs.length > 1 && (
        <p className="mt-1 text-xs text-slate-500">Each currency is totalled separately.</p>
      )}
    </Card>
  );
}

/** Sortable column header: a real button, with aria-sort on the cell. */
function SortHeader({ label, column, sort, onSort, align = 'left' }) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-4 py-2.5 font-medium', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none dark:hover:text-slate-100',
          active && 'text-slate-900 dark:text-slate-100',
        )}
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </th>
  );
}

function PlainHeader({ children, align = 'left' }) {
  return (
    <th scope="col" className={cn('px-4 py-2.5 font-medium', align === 'right' && 'text-right')}>
      {children}
    </th>
  );
}

/** Push monitors: what the customer's side sent us (free for their servers). */
function receivedText(row) {
  if (row.type === 'heartbeat') return `${formatCount(row.pings)} pings received`;
  if (row.type === 'agent') return `${formatCount(row.reports)} reports received`;
  return null;
}

function UsageRow({ row, wid, isCurrentMonth }) {
  const interval = usageInterval(row);
  const budget = usageBudget(row);
  const cost = costValue(row, isCurrentMonth);
  const received = receivedText(row);

  return (
    <tr className="border-t border-slate-200 align-top dark:border-slate-800">
      <th scope="row" className="px-4 py-3 text-left font-normal">
        <Link
          to={`/app/${wid}/monitors/${row.id}`}
          className="font-medium hover:underline focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
        >
          {row.name}
        </Link>
        <div className="mt-1">
          <Badge>{monitorTypeLabel(row.type)}</Badge>
        </div>
      </th>
      <td className="px-4 py-3">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {interval.label}
        {interval.markers.map((marker) => (
          <Badge key={marker} tone={marker === 'adaptive' ? 'blue' : 'amber'} className="ml-1.5">
            {marker}
          </Badge>
        ))}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatCount(row.requests)}
        {isCurrentMonth && row.estimatedMonthlyRequests > 0 && (
          <div className="text-xs text-slate-500">
            ≈ {formatCount(row.estimatedMonthlyRequests)} / month
          </div>
        )}
        {received && <div className="text-xs text-slate-500">{received}</div>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {cost == null ? (
          <span className="text-slate-500">No price</span>
        ) : (
          <>
            {formatCurrency(cost, row.currency)}
            {isCurrentMonth && row.actualCost != null && (
              <div className="text-xs text-slate-500">
                {formatCurrency(row.actualCost, row.currency)} so far
              </div>
            )}
          </>
        )}
      </td>
      <td className="w-48 px-4 py-3">
        {budget ? (
          <BudgetMeter summary={budget} compact />
        ) : (
          <span className="text-slate-500">No budget</span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{formatCount(row.requestsSaved)}</td>
    </tr>
  );
}

/**
 * Cost & usage: every request PulseBoard sent to the workspace's servers this
 * month, what that costs, and what push monitors and adaptive intervals saved
 * compared with polling every minute.
 */
export default function Usage() {
  const { wid, can } = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const options = monthOptions();
  const month = options.includes(params.get('month')) ? params.get('month') : options[0];
  const isCurrentMonth = month === monthOf();
  const [sort, setSort] = useState({ key: 'requests', direction: 'desc' });

  const { data, isPending, isError, isPlaceholderData } = useWorkspaceUsage(wid, month);
  const totals = data?.totals;
  const rows = data ? sortUsageRows(data.monitors, { ...sort, isCurrentMonth }) : [];

  const monthPicker = (
    <div>
      <label htmlFor="usage-month" className="mb-1.5 block text-sm font-medium">
        Month
      </label>
      <select
        id="usage-month"
        value={month}
        onChange={(event) => setParams({ month: event.target.value })}
        className={cn(inputClasses, 'w-44')}
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {formatMonth(m)}
            {m === options[0] ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Cost & usage"
        description="Requests PulseBoard sent to your servers, what they cost, and what push monitoring saved."
        action={monthPicker}
      />

      {isError && <p className="text-sm text-red-600">Couldn&apos;t load usage.</p>}

      {isPending && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[118px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </>
      )}

      {data && totals.monitors === 0 && (
        <EmptyState
          icon={Receipt}
          title="No monitors yet"
          description="Usage and costs appear here once you add a monitor."
          action={
            can('member') && (
              <Link to={`/app/${wid}/monitors/new`}>
                <Button>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New monitor
                </Button>
              </Link>
            )
          }
        />
      )}

      {data && totals.monitors > 0 && (
        <div className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label={isCurrentMonth ? 'Requests sent this month' : 'Requests sent'}
              value={formatCount(totals.requests)}
              hint={`Received from your side: ${formatCount(totals.pings)} pings, ${formatCount(totals.reports)} agent reports`}
            />
            <Tile
              label="Requests saved"
              value={formatCount(totals.requestsSaved)}
              hint="Compared with checking every monitor once a minute"
            />
            <Tile
              label="Estimated monthly requests"
              value={`≈ ${formatCount(totals.estimatedMonthlyRequests)}`}
              hint="At the current intervals"
            />
            <CostTile totals={totals} isCurrentMonth={isCurrentMonth} />
          </div>

          <Card>
            <CardHeader
              title="Per monitor"
              description={`${formatMonth(month)} · ${byTypeSentence(totals.byType)}`}
            />
            {/* Wide table: it scrolls inside the card on small screens, never the page. */}
            {/* Focusable so keyboard users can scroll it too. */}
            <div
              className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none focus-visible:ring-inset"
              role="region"
              aria-label="Usage per monitor"
              tabIndex={0}
            >
              <table className="w-full min-w-[56rem] text-sm">
                <caption className="sr-only">
                  Requests, cost, budget and savings per monitor for {formatMonth(month)}
                </caption>
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <SortHeader
                      label="Monitor"
                      column="name"
                      sort={sort}
                      onSort={(k) => setSort(nextSort(sort, k))}
                    />
                    <PlainHeader>Status</PlainHeader>
                    <PlainHeader>Interval</PlainHeader>
                    <SortHeader
                      label="Requests"
                      column="requests"
                      sort={sort}
                      onSort={(k) => setSort(nextSort(sort, k))}
                      align="right"
                    />
                    <SortHeader
                      label={isCurrentMonth ? 'Est. monthly cost' : 'Cost'}
                      column="cost"
                      sort={sort}
                      onSort={(k) => setSort(nextSort(sort, k))}
                      align="right"
                    />
                    <PlainHeader>Budget</PlainHeader>
                    <PlainHeader align="right">Requests saved</PlainHeader>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <UsageRow key={row.id} row={row} wid={wid} isCurrentMonth={isCurrentMonth} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">
              Heartbeat pings and agent reports are sent by your own jobs and apps, so they put no
              load on your servers. Agent monitors only count the probes PulseBoard sends when an
              agent goes silent.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
