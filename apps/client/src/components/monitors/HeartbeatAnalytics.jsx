import { useDailyUptime, useRecentChecks, useUptime } from '../../api/analytics.js';
import { formatDuration } from '../../lib/format.js';
import { pingHistory } from '../../lib/heartbeat.js';
import ChartCard from '../charts/ChartCard.jsx';
import PingHistoryChart from '../charts/PingHistoryChart.jsx';
import UptimeBars from '../charts/UptimeBars.jsx';
import UptimeLegend from '../charts/UptimeLegend.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import UptimeStats from './UptimeStats.jsx';

const PING_HISTORY_POINTS = 60;
const formatRun = (ms) => (ms == null ? '—' : formatDuration(ms / 1000));

/**
 * Uptime tiles, ping history and 90-day bars for a heartbeat monitor. Uptime
 * here means "share of expected pings that arrived" (one result per ping or
 * missed period), so the same tiles and bars as http monitors apply.
 */
export default function HeartbeatAnalytics({ wid, monitorId, side }) {
  const uptime = useUptime(wid, monitorId);
  const recent = useRecentChecks(wid, monitorId, PING_HISTORY_POINTS);
  const daily = useDailyUptime(wid, monitorId, 90);
  const history = pingHistory(recent.data?.points ?? []);
  const days = daily.data ?? [];

  const summary = [
    `${history.received} received`,
    `${history.missed} missed or failed`,
    history.avgDurationMs != null && `average run ${formatRun(history.avgDurationMs)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <UptimeStats uptime={uptime.data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Ping history"
          description={`Last ${PING_HISTORY_POINTS} pings and missed periods${history.entries.length ? ` · ${summary}` : ''}`}
          isRefreshing={recent.isPlaceholderData}
          table={{
            columns: [
              { key: 'time', label: 'Time' },
              { key: 'result', label: 'Result' },
              { key: 'duration', label: 'Run duration', align: 'right' },
            ],
            rows: [...history.entries].reverse().map((entry, i) => ({
              key: `${entry.t}-${i}`,
              time: new Date(entry.t).toLocaleString(),
              result: entry.label,
              duration: formatRun(entry.durationMs),
            })),
          }}
        >
          {recent.isPending ? (
            <Skeleton className="h-28" />
          ) : (
            <PingHistoryChart entries={history.entries} />
          )}
        </ChartCard>

        {side}
      </div>

      <ChartCard
        title="Uptime, last 90 days"
        sample={days.some((d) => d.sample)}
        description="Each bar is one day (UTC): the share of expected pings that arrived."
        table={{
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'uptime', label: 'Uptime', align: 'right' },
            { key: 'checks', label: 'Expected pings', align: 'right' },
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
    </>
  );
}
