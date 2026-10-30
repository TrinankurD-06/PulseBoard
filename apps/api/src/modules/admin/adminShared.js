import { PLATFORM_ROLES, ROLES } from '@pulseboard/shared/constants';
import { isDemoUserEmail } from '@pulseboard/shared/demo';
import { Membership, Monitor, User, Workspace } from '@pulseboard/shared/models';
import { AppError } from '../../lib/errors.js';

export const OBJECT_ID = /^[a-f\d]{24}$/i;
export const idString = (value) => String(value);

/**
 * The workspaces an administrator's actions on a user reach: the ones they own, plus every
 * workspace of the demo account (which is only a viewer of its own demo workspace). A workspace a
 * user was merely invited to belongs to someone else.
 */
export const isManaged = (user, membership) =>
  isDemoUserEmail(user.email) || membership.role === ROLES.OWNER;

export async function managedWorkspaceIds(user) {
  const memberships = await Membership.find({ userId: user._id }).lean();
  return memberships.filter((m) => isManaged(user, m)).map((m) => m.workspaceId);
}

/** Id -> lean document maps for the workspaces and owners behind a list of monitors. */
export async function loadMonitorContext(monitors) {
  const workspaceIds = [...new Set(monitors.map((m) => idString(m.workspaceId)))];
  const workspaces = await Workspace.find({ _id: { $in: workspaceIds } })
    .select('name ownerId suspendedAt')
    .lean();
  const ownerIds = [...new Set(workspaces.map((w) => idString(w.ownerId)))];
  const owners = await User.find({ _id: { $in: ownerIds } })
    .select('name email')
    .lean();
  return {
    workspaces: new Map(workspaces.map((w) => [idString(w._id), w])),
    owners: new Map(owners.map((u) => [idString(u._id), u])),
  };
}

/** Monitors per workspace id -> { total, paused, stoppedByAdmin, down }. */
export async function monitorCountsByWorkspace(workspaceIds) {
  if (!workspaceIds.length) return new Map();
  const rows = await Monitor.aggregate([
    { $match: { workspaceId: { $in: workspaceIds } } },
    {
      $group: {
        _id: '$workspaceId',
        total: { $sum: 1 },
        paused: { $sum: { $cond: ['$isPaused', 1, 0] } },
        stoppedByAdmin: { $sum: { $cond: [{ $eq: ['$pausedReason', 'admin'] }, 1, 0] } },
        down: { $sum: { $cond: [{ $eq: ['$status', 'down'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [idString(row._id), row]));
}

/** A typed confirmation must match exactly (the server checks it, not just the screen). */
export function requireConfirmation(given, expected, what) {
  if (typeof given !== 'string' || given.trim() !== expected) {
    throw new AppError(400, 'CONFIRMATION_MISMATCH', `Type ${what} exactly to confirm this action`);
  }
}

/** Administrators are not managed through the console: not yourself, not another superadmin. */
export function assertNotAdminTarget(admin, user) {
  if (idString(user._id) === admin.id) {
    throw new AppError(409, 'ADMIN_PROTECTED', 'You cannot do this to your own account');
  }
  if (user.platformRole === PLATFORM_ROLES.SUPERADMIN) {
    throw new AppError(
      409,
      'ADMIN_PROTECTED',
      'This is a platform administrator: remove their role with the admin:revoke script first',
    );
  }
}

export const clampPage = ({ page = 1, limit = 25 } = {}) => ({
  page: Math.max(1, Number(page) || 1),
  limit: Math.min(100, Math.max(1, Number(limit) || 25)),
});

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const searchRegex = (term) =>
  new RegExp(escapeRegex(String(term).trim().slice(0, 100)), 'i');
