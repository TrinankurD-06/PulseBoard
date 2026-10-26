import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from './http.js';

const channelsKey = (wid) => ['workspaces', wid, 'alert-channels'];
const unwrap = (res) => res.data.data;

export function useAlertChannels(wid) {
  return useQuery({
    queryKey: channelsKey(wid),
    queryFn: () => http.get(`/workspaces/${wid}/alert-channels?limit=100`).then(unwrap),
  });
}

function useChannelMutation(wid, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelsKey(wid) }),
  });
}

export const useCreateAlertChannel = (wid) =>
  useChannelMutation(wid, (values) =>
    http.post(`/workspaces/${wid}/alert-channels`, values).then(unwrap),
  );

export const useUpdateAlertChannel = (wid) =>
  useChannelMutation(wid, ({ id, ...patch }) =>
    http.patch(`/workspaces/${wid}/alert-channels/${id}`, patch).then(unwrap),
  );

export const useDeleteAlertChannel = (wid) =>
  useChannelMutation(wid, (id) => http.delete(`/workspaces/${wid}/alert-channels/${id}`));

/** Sends a test alert; resolves to { delivered, previewUrl }. */
export const useTestAlertChannel = (wid) =>
  useMutation({
    mutationFn: (id) => http.post(`/workspaces/${wid}/alert-channels/${id}/test`).then(unwrap),
  });
