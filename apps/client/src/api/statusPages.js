import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from './http.js';

const pagesKey = (wid) => ['workspaces', wid, 'status-pages'];
const unwrap = (res) => res.data.data;

export function useStatusPages(wid) {
  return useQuery({
    queryKey: pagesKey(wid),
    queryFn: () => http.get(`/workspaces/${wid}/status-pages?limit=100`).then(unwrap),
  });
}

function usePageMutation(wid, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pagesKey(wid) }),
  });
}

export const useCreateStatusPage = (wid) =>
  usePageMutation(wid, (values) =>
    http.post(`/workspaces/${wid}/status-pages`, values).then(unwrap),
  );

export const useUpdateStatusPage = (wid) =>
  usePageMutation(wid, ({ id, ...values }) =>
    http.patch(`/workspaces/${wid}/status-pages/${id}`, values).then(unwrap),
  );

export const useDeleteStatusPage = (wid) =>
  usePageMutation(wid, (id) => http.delete(`/workspaces/${wid}/status-pages/${id}`));

/** Public, no login. Refreshes every 30s, matching the server-side cache. */
export function usePublicStatus(slug) {
  return useQuery({
    queryKey: ['public-status', slug],
    queryFn: () => http.get(`/public/status/${encodeURIComponent(slug)}`).then(unwrap),
    refetchInterval: 30_000,
    retry: false,
  });
}

export const publicStatusUrl = (slug) => `${window.location.origin}/status/${slug}`;
