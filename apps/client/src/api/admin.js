import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cleanParams } from '../lib/adminConsole.js';
import { http } from './http.js';

// Everything the platform admin console reads or writes. Only a superadmin gets answers;
// everyone else gets a 404, so none of these retry.

const ROOT = ['admin'];
export const adminKeys = {
  overview: [...ROOT, 'overview'],
  system: [...ROOT, 'system'],
  list: (kind, params) => [...ROOT, kind, 'list', cleanParams(params)],
  detail: (kind, id) => [...ROOT, kind, 'detail', id],
};

const unwrap = (res) => res.data.data;

function useList(kind, params, options = {}) {
  return useQuery({
    queryKey: adminKeys.list(kind, params),
    queryFn: () =>
      http.get(`/admin/${kind}`, { params: cleanParams(params) }).then((res) => res.data),
    placeholderData: keepPreviousData,
    retry: false,
    ...options,
  });
}

function useDetail(kind, id) {
  return useQuery({
    queryKey: adminKeys.detail(kind, id),
    queryFn: () => http.get(`/admin/${kind}/${id}`).then(unwrap),
    enabled: Boolean(id),
    retry: false,
  });
}

export const useAdminOverview = () =>
  useQuery({
    queryKey: adminKeys.overview,
    queryFn: () => http.get('/admin/overview').then(unwrap),
    retry: false,
  });

/** The system page refreshes itself every 30 seconds. */
export const SYSTEM_REFRESH_MS = 30_000;
export const useAdminSystem = () =>
  useQuery({
    queryKey: adminKeys.system,
    queryFn: () => http.get('/admin/system').then(unwrap),
    refetchInterval: SYSTEM_REFRESH_MS,
    retry: false,
  });

export const useAdminUsers = (params, options) => useList('users', params, options);
export const useAdminUser = (id) => useDetail('users', id);
export const useAdminWorkspaces = (params, options) => useList('workspaces', params, options);
export const useAdminWorkspace = (id) => useDetail('workspaces', id);
export const useAdminMonitors = (params, options) => useList('monitors', params, options);
export const useAdminIncidents = (params, options) => useList('incidents', params, options);
export const useAdminIncident = (id) => useDetail('incidents', id);
export const useAdminAudit = (params, options) => useList('audit', params, options);

/**
 * A write. Every write can change what any list or detail shows (counts, statuses), so all
 * admin queries are refreshed afterwards.
 */
function useAdminWrite(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROOT }),
  });
}

const post = (path, body) => http.post(`/admin/${path}`, body).then(unwrap);
// axios sends a DELETE body through `data`.
const del = (path, body) => http.delete(`/admin/${path}`, { data: body }).then(unwrap);

export const useSuspendUser = () =>
  useAdminWrite(({ id, reason }) => post(`users/${id}/suspend`, { reason }));
export const useUnsuspendUser = () => useAdminWrite(({ id }) => post(`users/${id}/unsuspend`));
export const useRevokeSessions = () =>
  useAdminWrite(({ id }) => post(`users/${id}/revoke-sessions`));
export const useDeleteUser = () =>
  useAdminWrite(({ id, confirm, mode, reassignTo }) =>
    del(`users/${id}`, { confirm, mode, ...(mode === 'reassign' ? { reassignTo } : {}) }),
  );

export const useTransferWorkspace = () =>
  useAdminWrite(({ id, newOwnerId }) => post(`workspaces/${id}/transfer`, { newOwnerId }));
export const useSuspendWorkspace = () =>
  useAdminWrite(({ id, reason }) => post(`workspaces/${id}/suspend`, { reason }));
export const useUnsuspendWorkspace = () =>
  useAdminWrite(({ id }) => post(`workspaces/${id}/unsuspend`));
export const useDeleteWorkspace = () =>
  useAdminWrite(({ id, confirm }) => del(`workspaces/${id}`, { confirm }));

export const usePauseAdminMonitor = () =>
  useAdminWrite(({ id, note }) => post(`monitors/${id}/pause`, note ? { note } : {}));
export const useResumeAdminMonitor = () => useAdminWrite(({ id }) => post(`monitors/${id}/resume`));
/** Test now changes nothing worth refreshing, so no invalidation. */
export const useTestAdminMonitor = () =>
  useMutation({ mutationFn: ({ id }) => post(`monitors/${id}/test`) });
export const useDeleteAdminMonitor = () =>
  useAdminWrite(({ id, confirm }) => del(`monitors/${id}`, { confirm }));
export const useBulkMonitors = () =>
  useAdminWrite(({ action, ids, note, confirm }) =>
    post('monitors/bulk', {
      action,
      ids,
      ...(note ? { note } : {}),
      ...(action === 'delete' ? { confirm } : {}),
    }),
  );
