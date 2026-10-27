// Folds one live check result into a cached metrics response (see the Health
// deck contract). Pure: returns a new object, or the same one when the check
// is ignored. Only metrics that can be recomputed from the live accumulators
// are touched (failed, avgResponse for http, duration for heartbeat); the rest
// keep their values until the next refetch. Uptime is computed by the API from
// confirmed incidents, so it is never folded from live checks. Series points may
// carry `offline: true` (checker offline); they pass through untouched, and a
// check the checker could not judge ('unknown') is ignored.

const FOLDABLE = new Set(['failed', 'avgResponse', 'duration']);

const round = (value, digits) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const roundFor = (value, unit) => {
  if (value == null) return null;
  if (unit === 'ms' || unit === 'pings') return Math.round(value);
  return round(value, 2);
};

const add = (acc, ok, ms) => {
  const timed = ok && ms != null;
  return {
    n: acc.n + 1,
    ok: acc.ok + (ok ? 1 : 0),
    sumMs: acc.sumMs + (timed ? ms : 0),
    nMs: acc.nMs + (timed ? 1 : 0),
  };
};

const EMPTY = { n: 0, ok: 0, sumMs: 0, nMs: 0 };

// The value of a foldable metric from an accumulator, or null without data.
function fromAccumulator(key, acc) {
  if (key === 'failed') return acc.n ? ((acc.n - acc.ok) / acc.n) * 100 : null;
  // avgResponse, duration
  return acc.nMs ? acc.sumMs / acc.nMs : null;
}

/** Slide the grid forward by `shift` buckets: drop the oldest, append empty ones. */
function shiftSeries(series, shift, bucketMs, lastStart) {
  const keep = series.slice(Math.min(shift, series.length));
  const fresh = Array.from({ length: series.length - keep.length }, (_, i) => ({
    t: new Date(lastStart - (series.length - keep.length - 1 - i) * bucketMs).toISOString(),
    v: null,
  }));
  return [...keep, ...fresh];
}

function shiftTimings(timings, shift, bucketMs, lastStart) {
  if (!timings) return timings;
  const keep = timings.slice(Math.min(shift, timings.length));
  const fresh = Array.from({ length: timings.length - keep.length }, (_, i) => ({
    t: new Date(lastStart - (timings.length - keep.length - 1 - i) * bucketMs).toISOString(),
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    downloadMs: null,
  }));
  return [...keep, ...fresh];
}

function recomputeMetric(metric, last, range) {
  const series = metric.series.slice();
  const lastV = roundFor(fromAccumulator(metric.key, last), metric.unit);
  const tail = { ...series[series.length - 1], v: lastV };
  // A live result in the bucket means the checker is back.
  if (lastV != null) delete tail.offline;
  series[series.length - 1] = tail;
  const present = series.filter((p) => p.v != null).map((p) => p.v);
  const value = roundFor(fromAccumulator(metric.key, range), metric.unit);
  const previous = metric.previous;
  return {
    ...metric,
    series,
    value,
    current: present.length ? present.at(-1) : null,
    peak: present.length ? Math.max(...present) : null,
    low: present.length ? Math.min(...present) : null,
    average: present.length
      ? roundFor(present.reduce((a, b) => a + b, 0) / present.length, metric.unit)
      : null,
    change:
      value == null || previous == null || previous === 0
        ? null
        : round(((value - previous) / Math.abs(previous)) * 100, 1),
  };
}

/**
 * @param data   the cached metrics response (or undefined)
 * @param check  { lastCheckedAt, lastOk, lastResponseMs, lastState? } from a check:result event
 */
export function foldCheck(data, check) {
  if (!data?.live?.last || !data.metrics?.length || !check?.lastCheckedAt) return data;
  const at = Date.parse(check.lastCheckedAt);
  if (Number.isNaN(at)) return data;
  if (check.lastState === 'unknown') return data;
  if (data.live.lastAt && at <= Date.parse(data.live.lastAt)) return data;
  // Folding into an empty response would invent a grid; the next refetch fills it.
  if (data.empty) return data;

  const bucketMs = data.bucketMs;
  const prevStart = Date.parse(data.live.last.t);
  const shift = at >= prevStart + bucketMs ? Math.floor((at - prevStart) / bucketMs) : 0;
  const lastStart = prevStart + shift * bucketMs;
  const length = data.metrics[0].series.length;

  let metrics = data.metrics;
  let timings = data.timings;
  let from = data.from;
  let lastAcc = data.live.last;
  let rangeAcc = data.live.range ?? EMPTY;
  if (shift > 0) {
    metrics = metrics.map((m) => ({
      ...m,
      series: shiftSeries(m.series, shift, bucketMs, lastStart),
    }));
    timings = shiftTimings(timings, shift, bucketMs, lastStart);
    from = new Date(Date.parse(data.from) + shift * bucketMs).toISOString();
    lastAcc = { t: new Date(lastStart).toISOString(), ...EMPTY };
    // Past the whole window: nothing of the old range is left.
    if (shift >= length) rangeAcc = EMPTY;
  }

  const ok = Boolean(check.lastOk);
  const ms = check.lastResponseMs ?? null;
  const last = { ...lastAcc, ...add(lastAcc, ok, ms) };
  const range = add(rangeAcc, ok, ms);

  metrics = metrics.map((m) => (FOLDABLE.has(m.key) ? recomputeMetric(m, last, range) : m));

  return {
    ...data,
    from,
    to: check.lastCheckedAt,
    metrics,
    timings,
    live: { lastAt: check.lastCheckedAt, last, range },
  };
}
