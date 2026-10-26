import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { http, refreshAccessToken, setSessionExpiredHandler } from '../api/http.js';
import { setAccessToken } from '../api/tokenStore.js';
import { AuthContext, ME_QUERY_KEY } from './AuthContext.js';

export default function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  // 'idle' until a page that cares about the session asks for it (ensureSession),
  // so public pages like /status/:slug never call /auth/refresh.
  const [status, setStatus] = useState('idle');

  // No access token in memory after a page load: try the refresh cookie once.
  const sessionRequested = useRef(false);
  const ensureSession = useCallback(() => {
    if (sessionRequested.current) return;
    sessionRequested.current = true;
    setStatus('loading');
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
      ensureSession,
    }),
    [status, meQuery.isPending, meQuery.data, login, register, logout, ensureSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
