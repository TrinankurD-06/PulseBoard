import { hasRole } from '@pulseboard/shared/roles';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

/**
 * The workspace in the URL (:wid) and the current user's role in it.
 * `can('member')` hides UI the user isn't allowed to use. The server enforces
 * the same rules, so this is about UX, not security.
 */
export function useCurrentWorkspace() {
  const { wid } = useParams();
  const { workspaces } = useAuth();
  const workspace = workspaces.find((w) => w.id === wid) ?? null;
  return {
    wid,
    workspace,
    role: workspace?.role ?? null,
    can: (minimumRole) => Boolean(workspace) && hasRole(workspace.role, minimumRole),
  };
}
