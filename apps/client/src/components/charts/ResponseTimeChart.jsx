import { useId, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { failureCode, responseRows } from '../../lib/checks.js';
import { formatMs } from '../../lib/format.js';
import { OFFLINE_LABEL } from '../../lib/health.js';
import { offlineBands, segmentSeries } from '../../lib/segments.js';
import OfflineLegend from '../health/OfflineLegend.jsx';
import AreaGradient from './AreaGradient.jsx';
import {
  axisProps,
  cursorProps,
  formatTick,
  gridProps,
  LINE_STROKE,
  LINE_WIDTH,
  niceTicks,
  svgId,
  tooltipBoxClasses,
} from './chartTheme.js';

const activeDot = { r: 3.5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 };

// A failed check (or bucket containing one): a status-down marker with a bg ring.
const failureDot = { r: 4, fill: 'var(--status-down)', stroke: 'var(--bg)', strokeWidth: 2 };

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.offline) {
    return (
      <div className={tooltipBoxClasses}>
        <p className="text-fg">{new Date(point.t).toLocaleString()}</p>
        <p className="mt-1">{OFFLINE_LABEL}</p>
      </div>
    );
  }
  const code = failureCode(point);
  return (
    <div className={tooltipBoxClasses}>
      <p className="text-fg">{new Date(point.t).toLocaleString()}</p>
      <p className="mt-1">
        Response: <span className="font-mono text-fg tabular-nums">{formatMs(point.totalMs)}</span>
        {point.maxMs != null && <> (max {formatMs(point.maxMs)})</>}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-pill ${point.ok ? 'bg-status-up' : 'bg-status-down'}`}
        />
        {point.count
          ? `${point.count} checks · ${Math.round((point.upRatio ?? 1) * 100)}% passed`
          : point.ok
            ? 'Passed'
            : 'Failed'}
        {code && <span className="font-mono text-fg">{code}</span>}
      </p>
    </div>
  );
}

/**
 * Response time over the selected range: one 1.5px line in the text colour
 * over a fading wash, failed checks marked with a ringed dot. Single series,
 * so no legend box: the card title names it. Drawn per contiguous run: results
 * from a checker that was offline are a muted band (labelled), never a line,
 * a fill or a drop to zero.
 */
export default function ResponseTimeChart({ points, rangeMs }) {
  const id = svgId(useId(), 'rt');
  const chart = useMemo(() => {
    const base = responseRows(points);
    const { rows, lineKeys, dotKey } = segmentSeries(base, 'value', 'seg');
    const bands = offlineBands(
      base.map((r) => r.ts),
      base.map((r) => r.offline),
    );
    return { rows, lineKeys, dotKey, bands };
  }, [points]);

  if (points.length === 0) {
    return <p className="py-16 text-center text-sm text-muted">No checks in this range yet.</p>;
  }
  const ticks = niceTicks(Math.max(...chart.rows.map((p) => p.value ?? 0), 1));
  const top = ticks[ticks.length - 1];

  return (
    <div>
      {chart.bands.length > 0 && <OfflineLegend />}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <AreaGradient id={`${id}-area`} />
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              {...axisProps}
              tickFormatter={(value) => formatTick(value, rangeMs)}
              minTickGap={48}
            />
            <YAxis
              {...axisProps}
              width={52}
              tickFormatter={(ms) => formatMs(ms)}
              ticks={ticks}
              domain={[0, top]}
              interval={0}
            />
            <Tooltip content={<ChartTooltip />} cursor={cursorProps} />
            {chart.bands.map((band, i) => (
              <ReferenceArea
                key={`offline-${i}`}
                x1={band.x1}
                x2={band.x2}
                fill="var(--text-faint)"
                fillOpacity={0.14}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
            {chart.lineKeys.map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={LINE_STROKE}
                strokeWidth={LINE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${id}-area)`}
                connectNulls={false}
                dot={false}
                activeDot={activeDot}
                isAnimationActive={false}
              />
            ))}
            {chart.dotKey && (
              <Line
                dataKey={chart.dotKey}
                stroke="none"
                dot={{ r: 2.5, fill: LINE_STROKE, stroke: 'none' }}
                activeDot={activeDot}
                isAnimationActive={false}
              />
            )}
            <Line
              dataKey="failedValue"
              stroke="none"
              dot={failureDot}
              activeDot={failureDot}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
