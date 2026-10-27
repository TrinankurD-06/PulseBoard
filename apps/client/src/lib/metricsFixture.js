// Deterministic fixture generator for the metrics response (see the Health
// deck contract). Used by the unit tests and by the temporary dev switch in
// api/metrics.js; it is not part of the production bundle path.

const GRID = {
  '1h': { bucketMs: 60_000, count: 60 },
  '24h': { bucketMs: 15 * 60_000, count: 96 },
  '7d': { bucketMs: 2 * 3_600_000, count: 84 },
};

const SPECS = {
  http: [
    ['uptime', 'Uptime', '%'],
    ['p95', 'p95 response', 'ms'],
    ['failed', 'Failed checks', '%'],
    ['avgResponse', 'Avg response', 'ms'],
  ],
  heartbeat: [
    ['uptime', 'Uptime', '%'],
    ['missed', 'Missed pings', 'pings'],
    ['lateness', 'Avg lateness', 'ms'],
    ['duration', 'Job duration', 'ms'],
  ],
  agent: [
    ['requestRate', 'Request rate', 'req/s'],
    ['p95Latency', 'p95 latency', 'ms'],
    ['errorRate', 'Error rate', '%'],
    ['uptime', 'Uptime', '%'],
  ],
};

// Small seeded PRNG so a fixture is identical on every run.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function base(key, rand, i) {
  const wave = Math.sin(i / 7);
  switch (key) {
    case 'uptime':
      return rand() < 0.08 ? 90 + rand() * 8 : 100;
    case 'failed':
      return rand() < 0.08 ? rand() * 10 : 0;
    case 'p95':
      return 260 + wave * 60 + rand() * 90;
    case 'avgResponse':
      return 150 + wave * 30 + rand() * 40;
    case 'missed':
      return rand() < 0.1 ? 1 : 0;
    case 'lateness':
      return rand() * 800;
    case 'duration':
      return 3200 + wave * 400 + rand() * 500;
    case 'requestRate':
      return 4 + wave * 1.5 + rand();
    case 'p95Latency':
      return 210 + wave * 50 + rand() * 60;
    case 'errorRate':
      return rand() * 2.5;
    default:
      return rand();
  }
}

const round = (v, unit) =>
  unit === 'ms' || unit === 'pings' ? Math.round(v) : Math.round(v * 100) / 100;

/**
 * makeMetrics({ type, range, now, seed, empty, withTimings })
 * `live.last` / `live.range` are consistent with the generated series.
 */
export function makeMetrics({
  type = 'http',
  range = '24h',
  now = Date.now(),
  seed = 7,
  empty = false,
} = {}) {
  const { bucketMs, count } = GRID[range];
  const rand = rng(seed + count);
  const lastStart = Math.floor(now / bucketMs) * bucketMs;
  const from = lastStart - (count - 1) * bucketMs;
  const iso = (ms) => new Date(ms).toISOString();

  const metrics = SPECS[type].map(([key, label, unit]) => {
    const series = Array.from({ length: count }, (_, i) => ({
      t: iso(from + i * bucketMs),
      v: empty ? null : round(base(key, rand, i), unit),
    }));
    const present = series.filter((p) => p.v != null).map((p) => p.v);
    const mean = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
    const previous = mean == null ? null : round(mean * (0.9 + rand() * 0.2), unit);
    const value = mean == null ? null : round(mean, unit);
    return {
      key,
      label,
      unit,
      value,
      previous,
      change:
        value == null || !previous
          ? null
          : Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10,
      current: present.length ? present.at(-1) : null,
      peak: present.length ? Math.max(...present) : null,
      average: mean == null ? null : round(mean, unit),
      low: present.length ? Math.min(...present) : null,
      series,
    };
  });

  const timings =
    type === 'http'
      ? Array.from({ length: count }, (_, i) =>
          empty
            ? {
                t: iso(from + i * bucketMs),
                dnsMs: null,
                tcpMs: null,
                tlsMs: null,
                ttfbMs: null,
                downloadMs: null,
              }
            : {
                t: iso(from + i * bucketMs),
                dnsMs: Math.round(2 + rand() * 6),
                tcpMs: Math.round(8 + rand() * 12),
                tlsMs: Math.round(15 + rand() * 20),
                ttfbMs: Math.round(70 + rand() * 90),
                downloadMs: Math.round(2 + rand() * 8),
              },
        )
      : null;

  return {
    type,
    range,
    bucketMs,
    from: iso(from),
    to: iso(now),
    empty,
    metrics,
    timings,
    live: {
      lastAt: empty ? null : iso(lastStart + 1000),
      last: {
        t: iso(lastStart),
        n: empty ? 0 : 4,
        ok: empty ? 0 : 4,
        sumMs: empty ? 0 : 600,
        nMs: empty ? 0 : 4,
      },
      range: {
        n: empty ? 0 : count * 4,
        ok: empty ? 0 : count * 4 - 3,
        sumMs: empty ? 0 : count * 600,
        nMs: empty ? 0 : count * 4 - 3,
      },
    },
  };
}
