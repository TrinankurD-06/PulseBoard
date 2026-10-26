import { Membership } from '@pulseboard/shared/models';
import { hasRole } from '@pulseboard/shared/roles';
import { forbidden, notFound } from '../lib/errors.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * RBAC for routes under /workspaces/:wid. Loads the caller's Membership and
 * checks it against the minimum role. Sets req.membership for later handlers.
 *
 * Non-members get 404 (not 403) so the API doesn't reveal which workspace ids exist.
 */
export function requireRole(minimumRole) {
  return async (req, _res, next) => {
    const { wid } = req.params;
    if (!OBJECT_ID.test(wid)) throw notFound('Workspace not found');

    const membership = await Membership.findOne({ workspaceId: wid, userId: req.userId }).lean();
    if (!membership) throw notFound('Workspace not found');
    if (!hasRole(membership.role, minimumRole)) {
      throw forbidden(`This action requires the ${minimumRole} role`);
    }

    req.membership = membership;
    next();
  };
}
