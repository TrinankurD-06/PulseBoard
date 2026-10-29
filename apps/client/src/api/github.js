import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from './http.js';
import { monitorKeys } from './monitors.js';

const unwrap = (res) => res.data.data;

export const githubKeys = {
  all: (wid) => ['workspaces', wid, 'github', 'candidates'],
  candidates: (wid, forks) => ['workspaces', wid, 'github', 'candidates', Boolean(forks)],
};

// The server caches GitHub results for 10 minutes; asking again sooner only
// returns the same answer (or burns GitHub's rate limit when the cache is cold).
const CACHE_MS = 10 * 60 * 1000;

/**
 * Sites found in the signed-in user's public GitHub repos. Errors carry
 * meaning (not linked, rate limited), so they are not retried; refresh is
 * manual (`refetch`).
 */
export function useGithubCandidates(wid, { forks = false, enabled = true } = {}) {
  return useQuery({
    queryKey: githubKeys.candidates(wid, forks),
    queryFn: () =>
      http.get(`/workspaces/${wid}/github/candidates`, { params: { forks } }).then(unwrap),
    enabled,
    staleTime: CACHE_MS,
    gcTime: CACHE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/** Creates monitors (and optionally a status page) from the chosen URLs. */
export function useImportFromGithub(wid) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => http.post(`/workspaces/${wid}/github/import`, body).then(unwrap),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: monitorKeys.all(wid), exact: true }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', wid, 'status-pages'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', wid, 'uptime-summary'] }),
        // "Already monitored" flags changed; mark stale without hitting GitHub again.
        queryClient.invalidateQueries({ queryKey: githubKeys.all(wid), refetchType: 'none' }),
      ]),
  });
}
