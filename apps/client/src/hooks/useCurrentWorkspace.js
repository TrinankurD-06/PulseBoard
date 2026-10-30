import { hasRole } from '@pulseboard/shared/roles';
import { useParams } from 'react-router-dom';
import { useWorkspaceView } from '../api/workspaces.js';
import { useAuth } from '../auth/AuthContext.js';

/**
 * The workspace in the URL (:wid) and the current user's role in it.
 * `can('member')` hides UI the user isn't allowed to use. The server enforces
 * the same rules, so this is about UX, not security.
 *
 * An administrator who is not a member can still open the workspace: the API then answers
 * it as a read-only viewer (`adminView: true`), so `role` is 'viewer' and every edit action
 * the pages hide for viewers is hidden. `isLoading` is true while that is being fetched.
 */
export function useCurrentWorkspace() {
  const { wid } = useParams();
  const { workspaces, isAdmin } = useAuth();
  const member = workspaces.find((w) => w.id === wid) ?? null;
  const view = useWorkspaceView(wid, isAdmin && !member);
  const workspace = member ?? view.data ?? null;
  return {
    wid,
    workspace,
    role: workspace?.role ?? null,
    isLoading: !member && view.isPending && view.fetchStatus !== 'idle',
    isAdminView: !member && Boolean(workspace),
    can: (minimumRole) => Boolean(workspace) && hasRole(workspace.role, minimumRole),
  };
}
