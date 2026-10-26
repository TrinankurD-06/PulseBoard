/**
 * Tiny in-process cache with a time-to-live and a size cap (oldest entry
 * evicted first). Enough for one API instance; with several, each would keep
 * its own copy, which is fine for 30-second public data.
 */
export function createTtlCache({ ttlMs, maxEntries = 500, now = () => Date.now() }) {
  const entries = new Map();

  return {
    /** Returns { hit: true, value } or { hit: false }. `null` values are cached too. */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return { hit: false };
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return { hit: false };
      }
      return { hit: true, value: entry.value };
    },
    set(key, value) {
      entries.delete(key);
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    delete(key) {
      entries.delete(key);
    },
  };
}
