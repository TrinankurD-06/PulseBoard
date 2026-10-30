import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useId } from 'react';
import { useAdminOverview } from '../../api/admin.js';
import { ErrorLine, StatTile } from '../../components/admin/AdminBits.jsx';
import ChartCard from '../../components/charts/ChartCard.jsx';
import {
  axisProps,
  cursorProps,
  gridProps,
  niceTicks,
  svgId,
  tooltipBoxClasses,
  yAxisWidth,
} from '../../components/charts/chartTheme.js';
import AreaGradient from '../../components/charts/AreaGradient.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import {
  alertRows,
  alertsSinceText,
  checksPerDayRows,
  monitorStatusRows,
  monitorTypeRows,
  savedPercent,
} from '../../lib/adminConsole.js';
import { formatCount, formatMonth } from '../../lib/format.js';

function Tooltips({ active, payload, label, lines }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className={tooltipBoxClasses}>
      <p className="text-fg">{label ?? row.label}</p>
      {lines(row).map(([name, value]) => (
        <p key={name} className="mt-1">
          {name}: <span className="font-mono text-fg tabular-nums">{formatCount(value)}</span>
        </p>
      ))}
    </div>
  );
}

function ChecksPerDay({ rows }) {
  const id = svgId(useId(), 'checks');
  const max = Math.max(0, ...rows.map((row) => row.checks));
  const ticks = niceTicks(max);
  const width = yAxisWidth(ticks.map(formatCount));
  return (
    <div className="h-64" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={rows}
          margin={{ top: 12, right: 24, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <AreaGradient id={id} />
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} minTickGap={32} />
          <YAxis
            {...axisProps}
            width={width}
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
            tickFormatter={formatCount}
          />
          <Tooltip
            cursor={cursorProps}
            isAnimationActive={false}
            content={<Tooltips lines={(row) => [['Checks', row.checks]]} />}
          />
          <Area
            type="monotone"
            dataKey="checks"
            stroke="var(--series)"
            strokeWidth={1.5}
            fill={`url(#${id})`}
            dot={false}
            activeDot={{ r: 3.5, stroke: 'var(--bg)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars with the count printed at the end, so no value depends on colour. */
function CountBars({ rows }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div style={{ height: rows.length * 40 + 8 }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          barSize={14}
          accessibilityLayer={false}
        >
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis type="category" dataKey="label" {...axisProps} width={84} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            isAnimationActive={false}
            content={<Tooltips lines={(row) => [['Monitors', row.count]]} />}
          />
          <Bar dataKey="count" radius={4} isAnimationActive={false} minPointSize={2}>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.color ?? 'var(--series)'} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              formatter={formatCount}
              style={{ fill: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AlertBars({ rows }) {
  const max = Math.max(0, ...rows.flatMap((row) => [row.sent, row.failed]));
  const ticks = niceTicks(max);
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-3 rounded-sm bg-(--series)" /> Sent
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-3 rounded-sm bg-status-down" /> Failed
        </li>
      </ul>
      <div className="h-52" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
            barGap={4}
            accessibilityLayer={false}
          >
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis
              {...axisProps}
              width={yAxisWidth(ticks.map(formatCount))}
              ticks={ticks}
              domain={[0, ticks[ticks.length - 1]]}
              tickFormatter={formatCount}
            />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              isAnimationActive={false}
              content={
                <Tooltips
                  lines={(row) => [
                    ['Sent', row.sent],
                    ['Failed', row.failed],
                  ]}
                />
              }
            />
            <Bar
              dataKey="sent"
              fill="var(--series)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              maxBarSize={28}
            >
              <LabelList
                dataKey="sent"
                position="top"
                formatter={formatCount}
                style={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
            </Bar>
            <Bar
              dataKey="failed"
              fill="var(--status-down)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              maxBarSize={28}
            >
              <LabelList
                dataKey="failed"
                position="top"
                formatter={formatCount}
                style={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RequestsSaved({ data }) {
  const percent = savedPercent(data);
  return (
    <div className="py-2">
      {percent === null ? (
        <p className="text-sm text-muted">No push-monitor traffic this month yet.</p>
      ) : (
        <>
          <p className="text-4xl leading-none font-light tracking-[-0.03em] text-fg tabular-nums">
            {formatCount(data.requestsSaved)}
          </p>
          <p className="mt-2 text-sm text-muted">
            requests saved ({percent}% of {formatCount(data.requestsSaved + data.requestsSent)})
          </p>
          <div
            className="mt-5 flex h-2 w-full overflow-hidden rounded-pill bg-surface-2"
            role="img"
            aria-label={`${percent}% of requests saved, ${100 - percent}% sent`}
          >
            <span className="h-full bg-(--series)" style={{ width: `${percent}%` }} />
          </div>
          <dl className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-3 rounded-sm bg-(--series)" />
              <dt>Saved</dt>
              <dd className="font-mono text-fg tabular-nums">{formatCount(data.requestsSaved)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-3 rounded-sm bg-surface-2 ring-1 ring-line-strong"
              />
              <dt>Sent</dt>
              <dd className="font-mono text-fg tabular-nums">{formatCount(data.requestsSent)}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-6" role="status">
      <span className="sr-only">Loading…</span>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-card" />
    </div>
  );
}

/** The platform at a glance: counts, then how checks, monitors, alerts and push traffic look. */
export default function Overview() {
  const { data, isPending, isError, error } = useAdminOverview();

  const header = <PageHeader title="Overview." phrase="The whole platform, as of now." />;
  if (isPending) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  if (isError) {
    return (
      <>
        {header}
        <Card>
          <ErrorLine error={error} what="the overview" />
        </Card>
      </>
    );
  }

  const { users, workspaces, monitors, incidents, checksPerDay, alerts, requestsSaved } = data;
  const checks = checksPerDayRows(checksPerDay);
  const types = monitorTypeRows(monitors.byType);
  const statuses = monitorStatusRows(monitors.byStatus);
  const alertData = alertRows(alerts.perChannel);
  const since = alertsSinceText(alerts.since);

  return (
    <>
      {header}
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Users" value={formatCount(users.total)} to="/app/admin/users" />
          <StatTile label="New in 7 days" value={formatCount(users.new7)} hint="new users" />
          <StatTile label="New in 30 days" value={formatCount(users.new30)} hint="new users" />
          <StatTile
            label="Workspaces"
            value={formatCount(workspaces.total)}
            to="/app/admin/workspaces"
          />
          <StatTile label="Monitors" value={formatCount(monitors.total)} to="/app/admin/monitors" />
          <StatTile
            label="Failing now"
            value={formatCount(monitors.failingNow)}
            tone={monitors.failingNow > 0 ? 'red' : undefined}
            hint={monitors.failingNow > 0 ? 'down, or the last check failed' : 'all checks passing'}
            to="/app/admin/monitors?failing=true"
          />
          <StatTile
            label="Open incidents"
            value={formatCount(incidents.open)}
            hint={`${formatCount(incidents.last30)} in the last 30 days`}
            to="/app/admin/incidents?status=open"
          />
          <StatTile
            label="Suspended"
            value={formatCount(users.suspended)}
            hint={`users, and ${formatCount(workspaces.suspended)} ${workspaces.suspended === 1 ? 'workspace' : 'workspaces'}`}
            to="/app/admin/users?status=suspended"
          />
        </div>

        <ChartCard
          title="Checks per day"
          description="Every check run in the last 30 days."
          table={{
            columns: [
              { key: 'label', label: 'Day' },
              { key: 'checks', label: 'Checks', align: 'right' },
            ],
            rows: [...checks]
              .reverse()
              .map((row) => ({ key: row.key, label: row.label, checks: formatCount(row.checks) })),
          }}
        >
          <ChecksPerDay rows={checks} />
        </ChartCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Monitors by type"
            description={`${formatCount(monitors.total)} in all.`}
            table={{
              columns: [
                { key: 'label', label: 'Type' },
                { key: 'count', label: 'Monitors', align: 'right' },
              ],
              rows: types.map((row) => ({
                key: row.key,
                label: row.label,
                count: formatCount(row.count),
              })),
            }}
          >
            <CountBars rows={types} />
          </ChartCard>

          <ChartCard
            title="Monitors by status"
            description="Where each monitor stands right now."
            table={{
              columns: [
                { key: 'label', label: 'Status' },
                { key: 'count', label: 'Monitors', align: 'right' },
              ],
              rows: statuses.map((row) => ({
                key: row.key,
                label: row.label,
                count: formatCount(row.count),
              })),
            }}
          >
            <CountBars rows={statuses} />
          </ChartCard>

          <ChartCard
            title="Alerts sent and failed"
            description={since}
            table={{
              columns: [
                { key: 'label', label: 'Channel' },
                { key: 'sent', label: 'Sent', align: 'right' },
                { key: 'failed', label: 'Failed', align: 'right' },
              ],
              rows: alertData.map((row) => ({
                key: row.key,
                label: row.label,
                sent: formatCount(row.sent),
                failed: formatCount(row.failed),
              })),
            }}
          >
            {alerts.since ? (
              <AlertBars rows={alertData} />
            ) : (
              <p className="py-12 text-center text-sm text-muted">
                Alert history has not started yet, so there is nothing to chart.
              </p>
            )}
          </ChartCard>

          <ChartCard
            title="Requests saved by push monitors"
            description={`${formatMonth(requestsSaved.month)}: checks the monitored apps made unnecessary.`}
          >
            <RequestsSaved data={requestsSaved} />
          </ChartCard>
        </div>
      </div>
    </>
  );
}
