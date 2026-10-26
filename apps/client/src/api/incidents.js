import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { http } from './http.js';
import { fallbackPollMs } from './realtimeState.js';

/**
 * Incidents of a workspace, newest first. `status`: 'open' | 'resolved' | undefined (all).
 * Returns the full list envelope ({ data, pagination }) so callers can page.
 */
export function useIncidents(wid, { status, monitorId, page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page, limit });
  if (status) params.set('status', status);
  if (monitorId) params.set('monitorId', monitorId);
  return useQuery({
    queryKey: ['workspaces', wid, 'incidents', { status, monitorId, page, limit }],
    queryFn: () => http.get(`/workspaces/${wid}/incidents?${params}`).then((res) => res.data),
    placeholderData: keepPreviousData,
    refetchInterval: fallbackPollMs,
  });
}
