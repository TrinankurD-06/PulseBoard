import { useState } from 'react';
import { AGENT_RANGES, useAgentMetrics, useDailyUptime, useUptime } from '../../api/analytics.js';
import { formatPercent, metricsSeries, metricsSummary } from '../../lib/agent.js';
import { formatCount, formatDuration, formatMs } from '../../lib/format.js';
import ChartCard from '../charts/ChartCard.jsx';
import MetricLineChart from '../charts/MetricLineChart.jsx';
import UptimeBars from '../charts/UptimeBars.jsx';
import UptimeLegend from '../charts/UptimeLegend.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import AgentStatusCard from './AgentStatusCard.jsx';
import { RangeFilter } from './MonitorAnalytics.jsx';
import UptimeStats from './UptimeStats.jsx';

const RANGE_LABELS = { '1h': 'Last hour', '6h': 'Last 6 hours', '24h': 'Last 24 hours' };
const time = (t) => new Date(t).toLocaleString();
const formatRate = (value) => (value == null ? '—' : `${value}/min`);

const LATENCY_SERIES = [
  { key: 'p50Ms', label: 'p50', color: 'var(--text)' },
  { key: 'p95Ms', label: 'p95', color: 'var(--text-muted)', dash: '6 3' },
  { key: 'p99Ms', label: 'p99', color: 'var(--text-faint)', dash: '2 3' },
];

function TopRoutes({ routes, isPending }) {
  return (
    <Card>
      <CardHeader
        title="Top routes"
        description="Busiest route patterns in this range (never real URLs or ids)"
      />
      {isPending && <Skeleton className="m-5 h-24" />}
      {!isPending && routes.length === 0 && (
        <p className="p-5 text-sm text-muted">No traffic in this range.</p>
      )}
      {!isPending && routes.length > 0 && (
        <div className="overflow-x-auto p-5">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-faint">
              <tr>
                <th scope="col" className="py-2 pr-4 font-normal">
                  Route
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  Requests
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  5xx
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  p95
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {routes.map((route) => (
                <tr key={route.route}>
                  <td
                    className="max-w-xs truncate py-1.5 pr-4 font-mono text-xs text-muted"
                    title={route.route}
                  >
                    {route.route}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono text-xs text-muted">
                    {formatCount(route.requests)}
                  </td>
                  <td
                    className={`py-1.5 pr-4 text-right font-mono text-xs ${route.errors5xx > 0 ? 'text-status-down' : 'text-muted'}`}
                  >
                    {formatCount(route.errors5xx)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs text-muted">
                    {formatMs(route.p95Ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Agent monitors: uptime tiles, live charts from the agent's reports
 * (request rate, error rate against its threshold, p50/p95/p99), top routes,
 * the reporting status card and the 90-day bars.
 */
export default function AgentAnalytics({ wid, monitor, now }) {
  const [range, setRange] = useState('1h');
  const uptime = useUptime(wid, monitor.id);
  const metrics = useAgentMetrics(wid, monitor.id, range);
  const daily = useDailyUptime(wid, monitor.id, 90);

  const rows = metricsSeries(metrics.data?.points ?? [], monitor.reportEverySec);
  const summary = metricsSummary(rows);
  const days = daily.data ?? [];
  const rangeMs = AGENT_RANGES[range];
  const label = RANGE_LABELS[range];
  const refreshing = metrics.isPlaceholderData;
  const chart = (node) => (metrics.isPending ? <Skeleton className="h-56" /> : node);

  return (
    <>
      <UptimeStats uptime={uptime.data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AgentStatusCard
          wid={wid}
          monitor={monitor}
          lastReport={metrics.data?.lastReport}
          now={now}
        />
        <ChartCard
          title="Uptime, last 90 days"
          sample={days.some((d) => d.sample)}
          description="Each bar is one day (UTC): the share of reports (and probes) that passed."
          table={{
            columns: [
              { key: 'date', label: 'Date' },
              { key: 'uptime', label: 'Uptime', align: 'right' },
              { key: 'checks', label: 'Results', align: 'right' },
              { key: 'downtime', label: 'Downtime', align: 'right' },
            ],
            rows: [...days].reverse().map((d) => ({
              key: d.date,
              date: d.date,
              uptime: d.uptime == null ? 'No data' : `${d.uptime}%`,
              checks: d.totalChecks.toLocaleString(),
              downtime: d.downtimeSec ? formatDuration(d.downtimeSec) : '—',
            })),
          }}
        >
          {daily.isPending ? (
            <Skeleton className="h-14" />
          ) : (
            <>
              <UptimeBars days={days} />
              <UptimeLegend />
            </>
          )}
        </ChartCard>
      </div>

      {/* One filter row above the charts and routes it scopes. */}
      <RangeFilter value={range} onChange={setRange} ranges={AGENT_RANGES} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Request rate"
          description={`${label} · ${formatCount(summary.requests)} requests`}
          isRefreshing={refreshing}
          table={{
            columns: [
              { key: 'time', label: 'Report' },
              { key: 'requests', label: 'Requests', align: 'right' },
              { key: 'rate', label: 'Per minute', align: 'right' },
            ],
            rows: [...rows].reverse().map((r) => ({
              key: r.t,
              time: time(r.t),
              requests: formatCount(r.requests),
              rate: formatRate(r.perMinute),
            })),
          }}
        >
          {chart(
            <MetricLineChart
              data={rows}
              rangeMs={rangeMs}
              format={formatRate}
              series={[{ key: 'perMinute', label: 'Requests', color: 'var(--text)' }]}
            />,
          )}
        </ChartCard>

        <ChartCard
          title="Error rate (5xx)"
          description={`${label} · ${formatPercent(summary.errorRate)} overall · fails above ${monitor.errorRateThreshold}%`}
          isRefreshing={refreshing}
          table={{
            columns: [
              { key: 'time', label: 'Report' },
              { key: 'errors5xx', label: '5xx', align: 'right' },
              { key: 'errors4xx', label: '4xx', align: 'right' },
              { key: 'rate', label: '5xx rate', align: 'right' },
              { key: 'result', label: 'Result' },
            ],
            rows: [...rows].reverse().map((r) => ({
              key: r.t,
              time: time(r.t),
              errors5xx: formatCount(r.errors5xx),
              errors4xx: formatCount(r.errors4xx),
              rate: r.requests ? formatPercent(r.errorRate) : 'No traffic',
              result:
                r.errorRate != null && r.errorRate > monitor.errorRateThreshold
                  ? 'Above threshold'
                  : 'OK',
            })),
          }}
        >
          {chart(
            <MetricLineChart
              data={rows}
              rangeMs={rangeMs}
              format={formatPercent}
              series={[{ key: 'errorRate', label: '5xx rate', color: 'var(--text)' }]}
              thresholds={[
                {
                  value: monitor.errorRateThreshold,
                  label: `Threshold ${monitor.errorRateThreshold}%`,
                },
              ]}
            />,
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Latency"
          description={`${label} · p50, p95 and p99 per report${monitor.p95ThresholdMs != null ? ` · p95 fails above ${formatMs(monitor.p95ThresholdMs)}` : ''}`}
          isRefreshing={refreshing}
          table={{
            columns: [
              { key: 'time', label: 'Report' },
              { key: 'p50', label: 'p50', align: 'right' },
              { key: 'p95', label: 'p95', align: 'right' },
              { key: 'p99', label: 'p99', align: 'right' },
            ],
            rows: [...rows].reverse().map((r) => ({
              key: r.t,
              time: time(r.t),
              p50: formatMs(r.p50Ms),
              p95: formatMs(r.p95Ms),
              p99: formatMs(r.p99Ms),
            })),
          }}
        >
          {chart(
            <MetricLineChart
              data={rows}
              rangeMs={rangeMs}
              format={formatMs}
              series={LATENCY_SERIES}
              thresholds={
                monitor.p95ThresholdMs != null
                  ? [
                      {
                        value: monitor.p95ThresholdMs,
                        label: `p95 threshold ${formatMs(monitor.p95ThresholdMs)}`,
                      },
                    ]
                  : []
              }
            />,
          )}
        </ChartCard>
        <TopRoutes routes={metrics.data?.topRoutes ?? []} isPending={metrics.isPending} />
      </div>
    </>
  );
}
