import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { http } from './http.js';

export const workspaceUsageKey = (wid, month) => ['workspaces', wid, 'usage', month];

/**
 * Workspace Cost & usage for one month ("YYYY-MM"): { month, totals, monitors }.
 * Counters move slowly, so a minute of polling is plenty; keepPreviousData
 * keeps the table on screen while switching months.
 */
export function useWorkspaceUsage(wid, month) {
  return useQuery({
    queryKey: workspaceUsageKey(wid, month),
    queryFn: () =>
      http
        .get(`/workspaces/${wid}/usage`, { params: month ? { month } : undefined })
        .then((res) => res.data.data),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
