import { Outlet } from 'react-router-dom';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import NotFound from '../../pages/NotFound.jsx';
import FullPageSpinner from '../ui/FullPageSpinner.jsx';
import AppShell from './AppShell.jsx';

/**
 * Route element for every /app/:wid page: the app shell around the page. An administrator
 * who is not a member gets the same shell, read-only, under a banner saying so.
 */
export default function AppLayout() {
  const { workspace, isLoading } = useCurrentWorkspace();

  if (isLoading) return <FullPageSpinner />;
  if (!workspace)
    return <NotFound message="This workspace doesn't exist or you're not a member." />;

  return (
    <AppShell wid={workspace.id} workspace={workspace}>
      <Outlet />
    </AppShell>
  );
}
