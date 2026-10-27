// Pure statistics helpers: nearest-rank percentiles and a bounded reservoir.

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Nearest-rank percentile of an ascending-sorted array (p in 0..100).
 * Returns null for an empty array. Nearest-rank always returns a real sample,
 * which reads better than an interpolated value for latency.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return round1(sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]);
}

/**
 * Reservoir sampling ("algorithm R"): keeps a uniform random sample of at most
 * `capacity` values from a stream of any length, so memory stays bounded no
 * matter how much traffic a window sees.
 */
export function createReservoir(capacity, random = Math.random) {
  let seen = 0;
  const samples = [];
  return {
    add(value) {
      seen += 1;
      if (samples.length < capacity) {
        samples.push(value);
        return;
      }
      const j = Math.floor(random() * seen);
      if (j < capacity) samples[j] = value;
    },
    /** Ascending copy of the kept samples. */
    sorted() {
      return [...samples].sort((a, b) => a - b);
    },
    get size() {
      return samples.length;
    },
    get seen() {
      return seen;
    },
  };
}
