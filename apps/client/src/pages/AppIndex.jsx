import { FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import CreateWorkspaceModal from '../components/layout/CreateWorkspaceModal.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

/**
 * /app: platform administrators land on the admin console; everyone else jumps to the first
 * workspace, or is offered to create one if there are none.
 */
export default function AppIndex() {
  const { workspaces, isAdmin } = useAuth();
  const [creating, setCreating] = useState(false);

  if (isAdmin) return <Navigate to="/app/admin" replace />;
  if (workspaces.length > 0) return <Navigate to={`/app/${workspaces[0].id}`} replace />;

  return (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState
        icon={FolderPlus}
        title="No workspaces yet"
        description="Workspaces hold your monitors, alert channels and status pages."
        action={<Button onClick={() => setCreating(true)}>Create a workspace</Button>}
      />
      <CreateWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
