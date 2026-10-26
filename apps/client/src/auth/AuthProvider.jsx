import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { http, refreshAccessToken, setSessionExpiredHandler } from '../api/http.js';
import { setAccessToken } from '../api/tokenStore.js';
import { AuthContext, ME_QUERY_KEY } from './AuthContext.js';

export default function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('loading');

  // On first load there is no access token in memory: try the refresh cookie.
  useEffect(() => {
    refreshAccessToken()
      .then(() => setStatus('authenticated'))
      .catch(() => setStatus('anonymous'));
  }, []);

  const endSession = useCallback(() => {
    setAccessToken(null);
    queryClient.clear();
    setStatus('anonymous');
  }, [queryClient]);

  useEffect(() => setSessionExpiredHandler(endSession), [endSession]);

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => http.get('/auth/me').then((res) => res.data.data),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });

  const startSession = useCallback(
    (data) => {
      setAccessToken(data.accessToken);
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      setStatus('authenticated');
    },
    [queryClient],
  );

  const login = useCallback(
    async (credentials) => startSession((await http.post('/auth/login', credentials)).data.data),
    [startSession],
  );

  const register = useCallback(
    async (details) => startSession((await http.post('/auth/register', details)).data.data),
    [startSession],
  );

  const logout = useCallback(async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo(
    () => ({
      status,
      isLoadingProfile: status === 'authenticated' && meQuery.isPending,
      user: meQuery.data?.user ?? null,
      workspaces: meQuery.data?.workspaces ?? [],
      login,
      register,
      logout,
    }),
    [status, meQuery.isPending, meQuery.data, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
