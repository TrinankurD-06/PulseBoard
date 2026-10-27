import { metricsPrefix } from '../api/metrics.js';
import { foldCheck } from '../lib/metricsFold.js';

export const FLUSH_MS = 1000;

/**
 * Folds live check results into the cached Health deck metrics. Events are
 * buffered per monitor and applied at most once per FLUSH_MS, so a burst of
 * checks costs one cache write per cached range, and never a refetch.
 * Returns { push(event), dispose() }.
 */
export function createMetricsFolder(queryClient) {
  const buffer = new Map(); // `${wid}:${mid}` -> { wid, mid, events }
  let timer = null;

  function flush() {
    timer = null;
    const batches = [...buffer.values()];
    buffer.clear();
    for (const { wid, mid, events } of batches) {
      events.sort((a, b) => Date.parse(a.lastCheckedAt) - Date.parse(b.lastCheckedAt));
      for (const query of queryClient
        .getQueryCache()
        .findAll({ queryKey: metricsPrefix(wid, mid) })) {
        queryClient.setQueryData(query.queryKey, (data) =>
          events.reduce((acc, event) => foldCheck(acc, event), data),
        );
      }
    }
  }

  return {
    push({ monitorId, workspaceId, lastCheckedAt, lastOk, lastResponseMs }) {
      if (!lastCheckedAt) return;
      const key = `${workspaceId}:${monitorId}`;
      const entry = buffer.get(key) ?? { wid: workspaceId, mid: monitorId, events: [] };
      entry.events.push({ lastCheckedAt, lastOk, lastResponseMs });
      buffer.set(key, entry);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      buffer.clear();
    },
  };
}
