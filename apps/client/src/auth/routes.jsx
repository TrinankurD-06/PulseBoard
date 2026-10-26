import { Navigate, Outlet, useLocation } from 'react-router-dom';
import FullPageSpinner from '../components/ui/FullPageSpinner.jsx';
import { useAuth } from './AuthContext.js';

/** Only for logged-in users; others are sent to /login and brought back afterwards. */
export function ProtectedRoute() {
  const { status, isLoadingProfile } = useAuth();
  const location = useLocation();

  if (status === 'loading' || isLoadingProfile) return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Login/register: logged-in users skip straight to the app. */
export function GuestRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  return <Outlet />;
}
