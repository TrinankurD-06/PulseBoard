import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from './http.js';

const USERS_KEY = ['admin', 'users'];

/** Every user (paged, searchable). Only the administrator may call it; others get a 404. */
export function useAdminUsers({ search = '', page = 1, limit = 25 } = {}) {
  return useQuery({
    queryKey: [...USERS_KEY, { search, page, limit }],
    queryFn: () =>
      http
        .get('/admin/users', { params: { search: search || undefined, page, limit } })
        .then((res) => res.data),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Stops or starts the monitors of one user; refreshes the list afterwards. */
export function useSetUserMonitors() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, action }) =>
      http.post(`/admin/users/${userId}/monitors`, { action }).then((res) => res.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });
}
