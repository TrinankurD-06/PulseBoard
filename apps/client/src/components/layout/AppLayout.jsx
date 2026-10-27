import { Outlet } from 'react-router-dom';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import NotFound from '../../pages/NotFound.jsx';
import AppShell from './AppShell.jsx';

/** Route element for every /app/:wid page: the app shell around the page. */
export default function AppLayout() {
  const { workspace } = useCurrentWorkspace();

  if (!workspace)
    return <NotFound message="This workspace doesn't exist or you're not a member." />;

  return (
    <AppShell wid={workspace.id}>
      <Outlet />
    </AppShell>
  );
}
