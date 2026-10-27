import { useMemo } from 'react';
import { Area, Line, ReferenceArea } from 'recharts';
import { healthRows } from '../../lib/health.js';
import { offlineBands, segmentSeries } from '../../lib/segments.js';

/**
 * Chart data for a Health series: rows on a time axis, the series spread over
 * one key per contiguous run (so nothing is drawn across or under a gap), and
 * the muted bands for "Checker offline" buckets.
 */
export function useGapSeries(series) {
  return useMemo(() => {
    const base = healthRows(series);
    const { rows, lineKeys, dotKey } = segmentSeries(base, 'v', 'seg');
    const bands = offlineBands(
      base.map((r) => r.ts),
      base.map((r) => r.offline),
    );
    return { rows, lineKeys, dotKey, bands, hasOffline: bands.length > 0 };
  }, [series]);
}

/** The muted vertical bands; drawn first so lines sit above them. */
export function offlineBandLayers(bands) {
  return bands.map((band, i) => (
    <ReferenceArea
      key={`offline-${i}`}
      x1={band.x1}
      x2={band.x2}
      fill="var(--text-faint)"
      fillOpacity={0.14}
      stroke="none"
      ifOverflow="hidden"
    />
  ));
}

/**
 * One Area per run of two or more points (line + fill) and one stroke-less
 * Line that draws only the lone points as small dots (no fill).
 */
export function segmentLayers({
  lineKeys,
  dotKey,
  gradientId,
  strokeWidth = 1.25,
  activeDot,
  dotRadius = 2,
}) {
  const layers = lineKeys.map((key) => (
    <Area
      key={key}
      type="monotone"
      dataKey={key}
      stroke="var(--text)"
      strokeWidth={strokeWidth}
      fill={`url(#${gradientId})`}
      connectNulls={false}
      dot={false}
      activeDot={activeDot}
      isAnimationActive={false}
    />
  ));
  if (dotKey) {
    layers.push(
      <Line
        key={dotKey}
        type="monotone"
        dataKey={dotKey}
        stroke="none"
        dot={{ r: dotRadius, fill: 'var(--text)', stroke: 'none' }}
        activeDot={activeDot}
        isAnimationActive={false}
      />,
    );
  }
  return layers;
}
