// Gap handling for time series. A null (or non-finite) value is a gap: nothing
// is drawn across it or under it. A series is split into contiguous runs of
// present values; a run of two or more points is a line with a fill, a run of
// one is a lone dot with no fill. Pure, so every chart shares one rule.

const present = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Contiguous runs of present values as inclusive index ranges.
 * [1, 2, null, 3] -> [{ start: 0, end: 1 }, { start: 3, end: 3 }]
 */
export function splitSegments(values) {
  const segments = [];
  let start = -1;
  values.forEach((value, i) => {
    if (present(value)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      segments.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) segments.push({ start, end: values.length - 1 });
  return segments;
}

/**
 * Spreads one series over per-segment keys so each segment is its own
 * Area/Line (one contiguous run per key: no join, no fill under a gap).
 * Returns { rows, lineKeys, dotKey }: `rows` are copies carrying the extra
 * keys, `lineKeys` one key per run of 2+ points, `dotKey` the key holding the
 * lone points (or null when there are none).
 */
export function segmentSeries(rows, key, prefix = `${key}__`) {
  const values = rows.map((row) => row[key]);
  const out = rows.map((row) => ({ ...row }));
  const lineKeys = [];
  const dotKey = `${prefix}dot`;
  let hasDots = false;
  for (const { start, end } of splitSegments(values)) {
    if (end > start) {
      const lineKey = `${prefix}${lineKeys.length}`;
      lineKeys.push(lineKey);
      for (let i = start; i <= end; i += 1) out[i][lineKey] = values[i];
    } else {
      out[start][dotKey] = values[start];
      hasDots = true;
    }
  }
  return { rows: out, lineKeys, dotKey: hasDots ? dotKey : null };
}

/**
 * Time ranges of consecutive "offline" rows, for a muted vertical band. Each
 * band reaches half a step to either side of its first and last row (a band
 * of one bucket still has a width) and is clamped to the data's own extent.
 * `times` are ms timestamps (ascending), `flags` booleans of the same length.
 * Returns [{ x1, x2 }].
 */
export function offlineBands(times, flags) {
  if (times.length < 1) return [];
  const diffs = [];
  for (let i = 1; i < times.length; i += 1) diffs.push(times[i] - times[i - 1]);
  diffs.sort((a, b) => a - b);
  const step = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
  const min = times[0];
  const max = times[times.length - 1];
  const bands = [];
  let start = -1;
  const close = (end) => {
    const before = start > 0 ? (times[start] - times[start - 1]) / 2 : step / 2;
    const after = end < times.length - 1 ? (times[end + 1] - times[end]) / 2 : step / 2;
    bands.push({
      x1: Math.max(min, times[start] - before),
      x2: Math.min(max, times[end] + after),
    });
    start = -1;
  };
  flags.forEach((flag, i) => {
    if (flag) {
      if (start < 0) start = i;
    } else if (start >= 0) close(i - 1);
  });
  if (start >= 0) close(flags.length - 1);
  return bands;
}
