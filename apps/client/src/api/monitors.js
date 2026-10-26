import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from './http.js';

export const monitorKeys = {
  all: (wid) => ['workspaces', wid, 'monitors'],
  detail: (wid, mid) => ['workspaces', wid, 'monitors', mid],
};

/** All monitors of a workspace (the dashboard shows them all, so fetch the max page). */
export function useMonitors(wid) {
  return useQuery({
    queryKey: monitorKeys.all(wid),
    queryFn: () => http.get(`/workspaces/${wid}/monitors?limit=100`).then((res) => res.data.data),
  });
}

export function useMonitor(wid, mid) {
  return useQuery({
    queryKey: monitorKeys.detail(wid, mid),
    queryFn: () => http.get(`/workspaces/${wid}/monitors/${mid}`).then((res) => res.data.data),
  });
}

/** Every monitor mutation refreshes both the list and the affected detail. */
function useMonitorMutation(wid, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (monitor) => {
      if (monitor?.id) queryClient.setQueryData(monitorKeys.detail(wid, monitor.id), monitor);
      return queryClient.invalidateQueries({ queryKey: monitorKeys.all(wid), exact: true });
    },
  });
}

const unwrap = (res) => res.data.data;

export const useCreateMonitor = (wid) =>
  useMonitorMutation(wid, (values) =>
    http.post(`/workspaces/${wid}/monitors`, values).then(unwrap),
  );

export const useUpdateMonitor = (wid, mid) =>
  useMonitorMutation(wid, (values) =>
    http.patch(`/workspaces/${wid}/monitors/${mid}`, values).then(unwrap),
  );

export const usePauseMonitor = (wid, mid) =>
  useMonitorMutation(wid, () => http.post(`/workspaces/${wid}/monitors/${mid}/pause`).then(unwrap));

export const useResumeMonitor = (wid, mid) =>
  useMonitorMutation(wid, () =>
    http.post(`/workspaces/${wid}/monitors/${mid}/resume`).then(unwrap),
  );

export function useDeleteMonitor(wid, mid) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => http.delete(`/workspaces/${wid}/monitors/${mid}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: monitorKeys.detail(wid, mid) });
      return queryClient.invalidateQueries({ queryKey: monitorKeys.all(wid), exact: true });
    },
  });
}
