import { formatUptime } from '@pulseboard/shared/uptime';
import { useState } from 'react';
import {
  RANGES,
  useDailyUptime,
  useRecentChecks,
  useResponseTimes,
  useUptime,
} from '../../api/analytics.js';
import { failureCode, resultText } from '../../lib/checks.js';
import { formatDuration, formatMs } from '../../lib/format.js';
import { TIMING_PHASES } from '../../lib/timings.js';
import ChartCard from '../charts/ChartCard.jsx';
import ResponseTimeChart from '../charts/ResponseTimeChart.jsx';
import TimingBreakdownChart from '../charts/TimingBreakdownChart.jsx';
import UptimeBars from '../charts/UptimeBars.jsx';
import UptimeLegend from '../charts/UptimeLegend.jsx';
import { PillGroup } from '../ui/Pill.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import UptimeStats from './UptimeStats.jsx';

const RANGE_LABELS = { '1h': 'Last hour', '24h': 'Last 24 hours', '7d': 'Last 7 days' };
const time = (t) => new Date(t).toLocaleString();

export function RangeFilter({ value, onChange, ranges = RANGES }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-faint">Time range</span>
      <PillGroup
        label="Time range"
        options={Object.keys(ranges)}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

/** Uptime chips, response-time chart, timing breakdown and 90-day bars for one monitor. */
export default function MonitorAnalytics({ wid, monitorId, latestCheckCard }) {
  const [range, setRange] = useState('24h');
  const uptime = useUptime(wid, monitorId);
  const responses = useResponseTimes(wid, monitorId, range);
  const recent = useRecentChecks(wid, monitorId, 30);
  const daily = useDailyUptime(wid, monitorId, 90);

  const points = responses.data?.points ?? [];
  const recentPoints = recent.data?.points ?? [];
  const days = daily.data ?? [];

  return (
    <>
      <UptimeStats uptime={uptime.data} />

      {/* One filter row above the chart it scopes. */}
      <RangeFilter value={range} onChange={setRange} />

      <ChartCard
        title="Response time"
        description={
          responses.data?.downsampled
            ? `${RANGE_LABELS[range]} · averaged per ${formatDuration(responses.data.bucketSec)}; red marks a period with failures`
            : `${RANGE_LABELS[range]} · red dots are failed checks`
        }
        isRefreshing={responses.isPlaceholderData}
        sample={points.some((p) => p.sample)}
        table={{
          columns: [
            { key: 'time', label: 'Time' },
            { key: 'ms', label: 'Response', align: 'right' },
            { key: 'result', label: 'Result' },
            { key: 'code', label: 'Code', mono: true },
          ],
          rows: [...points].reverse().map((p) => ({
            key: p.t,
            time: time(p.t),
            ms: formatMs(p.totalMs),
            result: resultText(p),
            code: failureCode(p) ?? '—',
          })),
        }}
      >
        {responses.isPending ? (
          <Skeleton className="h-64" />
        ) : (
          <ResponseTimeChart points={points} rangeMs={RANGES[range]} />
        )}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Timing breakdown"
          description="Where the time went in the last 30 checks"
          table={{
            columns: [
              { key: 'time', label: 'Time' },
              ...TIMING_PHASES.map((phase) => ({
                key: phase.key,
                label: phase.label,
                align: 'right',
              })),
            ],
            rows: [...recentPoints]
              .reverse()
              .filter((p) => p.timings)
              .map((p) => ({
                key: p.t,
                time: new Date(p.t).toLocaleTimeString(),
                ...Object.fromEntries(
                  TIMING_PHASES.map((ph) => [ph.key, formatMs(p.timings[ph.key])]),
                ),
              })),
          }}
        >
          {recent.isPending ? (
            <Skeleton className="h-56" />
          ) : (
            <TimingBreakdownChart points={recentPoints} />
          )}
        </ChartCard>

        {latestCheckCard}
      </div>

      <ChartCard
        title="Uptime, last 90 days"
        sample={days.some((d) => d.sample)}
        description="Each bar is one day (UTC). Hover or focus a bar for details."
        table={{
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'uptime', label: 'Uptime', align: 'right' },
            { key: 'checks', label: 'Checks', align: 'right' },
            { key: 'downtime', label: 'Downtime', align: 'right' },
          ],
          rows: [...days].reverse().map((d) => ({
            key: d.date,
            date: d.date,
            uptime: d.uptime == null ? 'No data' : `${formatUptime(d.uptime)}%`,
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
