import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';
import FullPageSpinner from '../../components/ui/FullPageSpinner.jsx';
import { safeNextPath } from '../../lib/oauth.js';

/**
 * /auth/callback: where the server sends the browser after Google/GitHub.
 * On success the refresh cookie is already set, so the session is restored the
 * same way as after a page reload (ensureSession). Errors go back to /login,
 * which explains the code.
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const { status, ensureSession } = useAuth();
  const ok = params.get('status') === 'ok';

  useEffect(() => {
    if (ok) ensureSession();
  }, [ok, ensureSession]);

  if (!ok) {
    const code = params.get('code') ?? 'OAUTH_PROVIDER_ERROR';
    return <Navigate to="/login" replace state={{ oauthError: code }} />;
  }
  if (status === 'authenticated') return <Navigate to={safeNextPath(params.get('next'))} replace />;
  // The cookie didn't arrive (blocked third-party cookies, an expired attempt).
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ oauthError: 'OAUTH_SESSION_MISSING' }} />;
  }
  return <FullPageSpinner />;
}
