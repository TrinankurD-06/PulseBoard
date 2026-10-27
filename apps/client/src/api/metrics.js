import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { http } from './http.js';
import { fallbackPollMs } from './realtimeState.js';

const unwrap = (res) => res.data.data;

// Deliberately NOT under analyticsKey(...): every check result invalidates that
// prefix, but the Health deck patches its own cache from the live event.
export const metricsKey = (wid, mid, range) => [
  'workspaces',
  wid,
  'monitors',
  mid,
  'metrics',
  range,
];
/** Prefix matching every cached range of one monitor's metrics. */
export const metricsPrefix = (wid, mid) => ['workspaces', wid, 'monitors', mid, 'metrics'];

// Background resync of what live events can't fold (p95, agent metrics):
// every 60 s, or sooner when the socket is down and the shared fallback poll applies.
const BACKGROUND_MS = 60_000;
const refetchInterval = () => {
  const fallback = fallbackPollMs();
  return fallback === false ? BACKGROUND_MS : Math.min(BACKGROUND_MS, fallback);
};

/** The Health deck data: { type, range, metrics: [...], timings, empty, live }. */
export function useMetrics(wid, mid, range) {
  return useQuery({
    queryKey: metricsKey(wid, mid, range),
    queryFn: () =>
      http.get(`/workspaces/${wid}/monitors/${mid}/metrics`, { params: { range } }).then(unwrap),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
}
