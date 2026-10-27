import { Outlet } from 'react-router-dom';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import { useRealtime } from '../../realtime/useRealtime.js';
import NotFound from '../../pages/NotFound.jsx';
import HeaderLine from './HeaderLine.jsx';
import TextNav from './TextNav.jsx';

/**
 * Shell for every /app/:wid page: a header line and a text nav on top (a
 * hairline bottom bar on mobile). No sidebar.
 */
export default function AppLayout() {
  const { workspace } = useCurrentWorkspace();
  const { connected } = useRealtime();

  if (!workspace)
    return <NotFound message="This workspace doesn't exist or you're not a member." />;

  return (
    <div className="mx-auto min-h-screen w-full max-w-7xl px-4 pt-4 pb-24 sm:px-6 md:pb-12 lg:px-8">
      <div className="space-y-3 pb-10">
        <HeaderLine wid={workspace.id} connected={connected} />
        <TextNav wid={workspace.id} />
      </div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
