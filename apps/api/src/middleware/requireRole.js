import { ROLES } from '@pulseboard/shared/constants';
import { Membership, Workspace } from '@pulseboard/shared/models';
import { hasRole } from '@pulseboard/shared/roles';
import { recordAuditOnce } from '../lib/adminAudit.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { loadAdminStanding } from './requireSuperadmin.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * RBAC for routes under /workspaces/:wid. Loads the caller's Membership and
 * checks it against the minimum role. Sets req.membership for later handlers.
 *
 * Non-members get 404 (not 403) so the API doesn't reveal which workspace ids exist.
 *
 * Two platform-level rules sit on top of the workspace role:
 * - a SUSPENDED workspace answers 403 WORKSPACE_SUSPENDED to its members (except the one route
 *   that lets them read why: `allowSuspended`);
 * - a platform administrator (superadmin) may READ any workspace as a viewer, never write. The
 *   read is audit-logged (once per ten minutes per workspace) and marked req.membership.adminView.
 */
export function requireRole(minimumRole, { allowSuspended = false } = {}) {
  return async (req, _res, next) => {
    const { wid } = req.params;
    if (!OBJECT_ID.test(wid)) throw notFound('Workspace not found');

    const [membership, workspace] = await Promise.all([
      Membership.findOne({ workspaceId: wid, userId: req.userId }).lean(),
      Workspace.findById(wid).select('suspendedAt suspendedReason').lean(),
    ]);

    if (!membership) {
      const admin = workspace ? await loadAdminStanding(req.userId) : null;
      if (!admin) throw notFound('Workspace not found');
      // Administrators look, they do not change: a write is refused as for any viewer.
      if (!READ_METHODS.has(req.method)) {
        throw forbidden('Administrators can view this workspace but not change it');
      }
      if (!hasRole(ROLES.VIEWER, minimumRole)) {
        throw forbidden(`This action requires the ${minimumRole} role`);
      }
      await recordAuditOnce(
        req,
        { action: 'workspace.view', targetType: 'workspace', targetId: wid },
        { admin },
      );
      req.membership = {
        workspaceId: wid,
        userId: req.userId,
        role: ROLES.VIEWER,
        adminView: true,
      };
      return next();
    }

    if (workspace?.suspendedAt && !allowSuspended) {
      throw new AppError(
        403,
        'WORKSPACE_SUSPENDED',
        workspace.suspendedReason
          ? `This workspace has been suspended by an administrator: ${workspace.suspendedReason}`
          : 'This workspace has been suspended by an administrator.',
        workspace.suspendedReason ? { reason: workspace.suspendedReason } : undefined,
      );
    }
    if (!hasRole(membership.role, minimumRole)) {
      throw forbidden(`This action requires the ${minimumRole} role`);
    }

    req.membership = membership;
    next();
  };
}
