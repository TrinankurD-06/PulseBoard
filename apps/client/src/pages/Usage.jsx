import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWorkspaceUsage } from '../api/usage.js';
import BudgetMeter from '../components/monitors/BudgetMeter.jsx';
import StatusBadge from '../components/monitors/StatusBadge.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import Card from '../components/ui/Card.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import RingDotCta from '../components/ui/RingDotCta.jsx';
import SteppedCards from '../components/ui/SteppedCards.jsx';
import TickGauge from '../components/gauge/TickGauge.jsx';
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

// Budget gauges turn red above this share of the monthly request budget
// (target 80 with direction 'below': the value is healthy while it stays below).
const BUDGET_GAUGE_TARGET = 80;

/** Cost per currency, never summed: each currency is its own line. */
function CostSummary({ totals, isCurrentMonth }) {
  const costs = totals.costByCurrency ?? [];
  return (
    <Card className="mt-8 p-6">
      <p className="text-[11px] text-faint">{isCurrentMonth ? 'Cost so far' : 'Cost'}</p>
      {costs.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No prices set. Add a price per 1,000 requests when editing a monitor.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {costs.map((c) => (
            <li key={c.currency} className="flex flex-wrap items-baseline gap-x-4">
              <span className="text-4xl font-light tracking-[-0.03em] text-fg tabular-nums">
                {formatCurrency(c.actual, c.currency)}
              </span>
              {isCurrentMonth && (
                <span className="font-mono text-xs text-faint">
                  ≈ {formatCurrency(c.estimatedMonthly, c.currency)} / month
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {costs.length > 1 && (
        <p className="mt-3 text-xs text-faint">Each currency is totalled separately.</p>
      )}
    </Card>
  );
}

/** Sortable column header: a text button, with aria-sort on the cell. */
function SortHeader({ label, column, sort, onSort, align = 'left' }) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-4 py-3 font-normal', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 rounded-pill transition-colors duration-200 hover:text-fg',
          active && 'text-fg',
        )}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </button>
    </th>
  );
}

function PlainHeader({ children, align = 'left' }) {
  return (
    <th scope="col" className={cn('px-4 py-3 font-normal', align === 'right' && 'text-right')}>
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
    <tr className="border-t border-line align-top transition-colors duration-200 hover:bg-surface">
      <th scope="row" className="px-4 py-3 text-left font-normal">
        <Link
          to={`/app/${wid}/monitors/${row.id}`}
          className="text-fg transition-colors duration-200 hover:text-brand"
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
      <td className="px-4 py-3 font-mono text-[13px] whitespace-nowrap text-muted">
        {interval.label}
        {interval.markers.map((marker) => (
          <Badge key={marker} tone={marker === 'adaptive' ? 'blue' : 'amber'} className="ml-1.5">
            {marker}
          </Badge>
        ))}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-fg tabular-nums">
        {formatCount(row.requests)}
        {isCurrentMonth && row.estimatedMonthlyRequests > 0 && (
          <div className="text-[11px] text-faint">
            ≈ {formatCount(row.estimatedMonthlyRequests)} / month
          </div>
        )}
        {received && <div className="text-[11px] text-faint">{received}</div>}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-fg tabular-nums">
        {cost == null ? (
          <span className="text-faint">No price</span>
        ) : (
          <>
            {formatCurrency(cost, row.currency)}
            {isCurrentMonth && row.actualCost != null && (
              <div className="text-[11px] text-faint">
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
          <span className="text-faint">No budget</span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-fg tabular-nums">
        {formatCount(row.requestsSaved)}
      </td>
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
      <label htmlFor="usage-month" className="sr-only">
        Month
      </label>
      <select
        id="usage-month"
        value={month}
        onChange={(event) => setParams({ month: event.target.value })}
        className="h-8 cursor-pointer rounded-pill border border-line bg-transparent px-3.5 text-[13px] text-muted transition-colors duration-200 hover:border-line-strong hover:text-fg [&>option]:bg-bg [&>option]:text-fg"
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

  const budgetRows = data ? rows.filter((row) => usageBudget(row)) : [];

  return (
    <>
      <PageHeader
        title="Cost & usage."
        phrase="Requests PulseBoard sent to your servers, what they cost, and what push monitoring saved."
        action={monthPicker}
      />

      {isError && <p className="text-sm text-status-down">Couldn&apos;t load usage.</p>}

      {isPending && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56 rounded-card" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-card" />
        </>
      )}

      {data && totals.monitors === 0 && (
        <EmptyState
          title="No monitors yet"
          description="Usage and costs appear here once you add a monitor."
          action={
            can('member') && <RingDotCta to={`/app/${wid}/monitors/new`}>New monitor</RingDotCta>
          }
        />
      )}

      {data && totals.monitors > 0 && (
        <div className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}>
          <SteppedCards
            items={[
              {
                value: totals.requests,
                label: isCurrentMonth ? 'Requests sent this month' : 'Requests sent',
                description: `Received from your side: ${formatCount(totals.pings)} pings, ${formatCount(totals.reports)} agent reports`,
              },
              {
                value: totals.requestsSaved,
                label: 'Requests saved',
                description: 'Compared with checking every monitor once a minute',
              },
              {
                value: totals.estimatedMonthlyRequests,
                label: 'Estimated monthly requests',
                description: 'At the current intervals, about this many a month',
              },
            ]}
          />

          <CostSummary totals={totals} isCurrentMonth={isCurrentMonth} />

          {budgetRows.length > 0 && (
            <section aria-label="Monthly request budgets" className="mt-12">
              <h2 className="mb-6 text-[11px] text-faint">Monthly request budgets</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
                {budgetRows.map((row) => {
                  const budget = usageBudget(row);
                  return (
                    <div key={row.id}>
                      <TickGauge
                        value={budget.percent}
                        target={BUDGET_GAUGE_TARGET}
                        thresholdDirection="below"
                        size={200}
                        label="of budget"
                        caption={`${formatCount(budget.used)} of ${formatCount(budget.budget)}`}
                        ariaLabel={`${row.name}: ${budget.percent}% of the monthly request budget used`}
                      />
                      <p className="mt-3 truncate text-center text-sm text-muted">{row.name}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-12">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 className="text-lg font-light tracking-[-0.02em] text-fg">Per monitor</h2>
              <p className="text-[11px] text-faint">
                {formatMonth(month)} · {byTypeSentence(totals.byType)}
              </p>
            </div>
            {/* Wide table: it scrolls inside the card on small screens, never the page. */}
            {/* Focusable so keyboard users can scroll it too. */}
            <div
              className="overflow-x-auto border-y border-line"
              role="region"
              aria-label="Usage per monitor"
              tabIndex={0}
            >
              <table className="w-full min-w-[56rem] text-sm">
                <caption className="sr-only">
                  Requests, cost, budget and savings per monitor for {formatMonth(month)}
                </caption>
                <thead className="text-left text-[11px] text-faint">
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
            <p className="mt-4 max-w-[70ch] text-[11px] text-faint">
              Heartbeat pings and agent reports are sent by your own jobs and apps, so they put no
              load on your servers. Agent monitors only count the probes PulseBoard sends when an
              agent goes silent.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
