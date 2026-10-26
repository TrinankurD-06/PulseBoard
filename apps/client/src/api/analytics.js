import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { http } from './http.js';
import { fallbackPollMs } from './realtimeState.js';

const unwrap = (res) => res.data.data;

// Everything analytical about one monitor lives under this prefix, so a live
// check result can refresh all of it with one invalidateQueries call.
export const analyticsKey = (wid, mid, ...rest) => [
  'workspaces',
  wid,
  'monitors',
  mid,
  'analytics',
  ...rest,
];
export const sparklinesKey = (wid) => ['workspaces', wid, 'sparklines'];

export const RANGES = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// keepPreviousData: when refreshing or switching range, keep showing the old
// chart (dimmed) instead of flashing a skeleton.
const shared = { placeholderData: keepPreviousData, refetchInterval: fallbackPollMs };

export function useUptime(wid, mid) {
  return useQuery({
    queryKey: analyticsKey(wid, mid, 'uptime'),
    queryFn: () => http.get(`/workspaces/${wid}/monitors/${mid}/uptime`).then(unwrap),
    ...shared,
  });
}

export function useResponseTimes(wid, mid, range) {
  return useQuery({
    queryKey: analyticsKey(wid, mid, 'checks', range),
    queryFn: () => {
      const from = new Date(Date.now() - RANGES[range]).toISOString();
      return http.get(`/workspaces/${wid}/monitors/${mid}/checks?from=${from}`).then(unwrap);
    },
    ...shared,
  });
}

export function useRecentChecks(wid, mid, limit = 30) {
  return useQuery({
    queryKey: analyticsKey(wid, mid, 'recent', limit),
    queryFn: () =>
      http.get(`/workspaces/${wid}/monitors/${mid}/checks?limit=${limit}`).then(unwrap),
    ...shared,
  });
}

export function useDailyUptime(wid, mid, days = 90) {
  return useQuery({
    queryKey: analyticsKey(wid, mid, 'daily', days),
    queryFn: () => http.get(`/workspaces/${wid}/monitors/${mid}/daily?days=${days}`).then(unwrap),
    ...shared,
  });
}

/** { [monitorId]: [{ t, ms, ok }] } for the dashboard cards. Live updates append to it. */
export function useSparklines(wid) {
  return useQuery({
    queryKey: sparklinesKey(wid),
    queryFn: () => http.get(`/workspaces/${wid}/monitors/sparklines?points=30`).then(unwrap),
    refetchInterval: fallbackPollMs,
  });
}
