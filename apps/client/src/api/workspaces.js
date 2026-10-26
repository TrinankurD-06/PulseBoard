import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '../auth/AuthContext.js';
import { http } from './http.js';

const membersKey = (wid) => ['workspaces', wid, 'members'];

export function useMembers(wid) {
  return useQuery({
    queryKey: membersKey(wid),
    queryFn: () => http.get(`/workspaces/${wid}/members?limit=100`).then((res) => res.data.data),
  });
}

function useMemberMutation(wid, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey(wid) }),
  });
}

export const useAddMember = (wid) =>
  useMemberMutation(wid, (values) => http.post(`/workspaces/${wid}/members`, values));

export const useChangeMemberRole = (wid) =>
  useMemberMutation(wid, ({ userId, role }) =>
    http.patch(`/workspaces/${wid}/members/${userId}`, { role }),
  );

export const useRemoveMember = (wid) =>
  useMemberMutation(wid, (userId) => http.delete(`/workspaces/${wid}/members/${userId}`));

/** Workspace changes alter the "me" payload (workspace list + roles), so refetch it. */
function useWorkspaceMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
}

export const useCreateWorkspace = () =>
  useWorkspaceMutation((values) => http.post('/workspaces', values).then((res) => res.data.data));

export const useRenameWorkspace = (wid) =>
  useWorkspaceMutation((values) => http.patch(`/workspaces/${wid}`, values));

export const useDeleteWorkspace = (wid) =>
  useWorkspaceMutation(() => http.delete(`/workspaces/${wid}`));
