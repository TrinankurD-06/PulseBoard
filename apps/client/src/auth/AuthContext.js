import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

export const ME_QUERY_KEY = ['me'];

/**
 * { status: 'idle'|'loading'|'authenticated'|'anonymous', user, workspaces,
 *   login, register, logout, ensureSession }
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
