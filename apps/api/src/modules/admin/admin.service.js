import { PAUSED_REASONS, ROLES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { isDemoUserEmail } from '@pulseboard/shared/demo';
import { Membership, Monitor, Session, User } from '@pulseboard/shared/models';
import bcrypt from 'bcrypt';
import { notFound } from '../../lib/errors.js';
import { createWorkspaceWithOwner } from '../workspaces/workspaces.service.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `email` is the administrator's (ADMIN_EMAIL; case-insensitive). */
export function isAdminEmail(env, email) {
  return Boolean(env.ADMIN_EMAIL) && String(email ?? '').toLowerCase() === env.ADMIN_EMAIL;
}

/**
 * Creates the administrator account from ADMIN_EMAIL / ADMIN_PASSWORD, or brings its password
 * in line with ADMIN_PASSWORD, so the environment stays the one place the secret lives. Does
 * nothing unless both are set. Creating it at start-up also means nobody can register the
 * admin address first. Returns 'disabled' | 'created' | 'updated' | 'unchanged'.
 */
export async function ensureAdminAccount({ env, logger, bcryptCost = env.BCRYPT_COST }) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return 'disabled';
  const existing = await User.findOne({ email: env.ADMIN_EMAIL }).select('+passwordHash');
  if (!existing) {
    const user = await User.create({
      name: 'Administrator',
      email: env.ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, bcryptCost),
    });
    await createWorkspaceWithOwner({ name: 'Administration', ownerId: user._id });
    logger?.info('Admin account created');
    return 'created';
  }
  if (existing.passwordHash && (await bcrypt.compare(env.ADMIN_PASSWORD, existing.passwordHash))) {
    return 'unchanged';
  }
  existing.passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, bcryptCost);
  await existing.save();
  logger?.info('Admin password updated from the environment');
  return 'updated';
}

/**
 * What the admin panel does. `monitors` is the monitor service (its pause and resume do the
 * scheduler and incident work).
 *
 * A user's "managed" workspaces are the ones they own, plus every workspace of the demo
 * account (which is only a viewer of its own demo workspace). The stop/start button acts on
 * the monitors in those workspaces, never on a workspace the user merely belongs to.
 */
export function createAdminService({ monitors }) {
  const managed = (user, membership) =>
    isDemoUserEmail(user.email) || membership.role === ROLES.OWNER;

  return {
    async listUsers({ search = '', page = 1, limit = 25 } = {}) {
      const term = String(search).trim().slice(0, 100);
      const filter = term
        ? {
            $or: [
              { name: new RegExp(escapeRegex(term), 'i') },
              { email: new RegExp(escapeRegex(term), 'i') },
            ],
          }
        : {};
      const [total, users] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .select('name email createdAt identities.provider')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const ids = users.map((user) => user._id);

      const [memberships, sessions] = await Promise.all([
        Membership.find({ userId: { $in: ids } })
          .populate('workspaceId', 'name')
          .lean(),
        Session.aggregate([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', last: { $max: '$createdAt' } } },
        ]),
      ]);
      const lastSeen = new Map(sessions.map((row) => [String(row._id), row.last]));

      const workspaceIds = [
        ...new Set(memberships.filter((m) => m.workspaceId).map((m) => String(m.workspaceId._id))),
      ];
      const counts = await Monitor.aggregate([
        {
          $match: {
            workspaceId: { $in: workspaceIds.map((id) => new mongoose.Types.ObjectId(id)) },
          },
        },
        {
          $group: {
            _id: '$workspaceId',
            total: { $sum: 1 },
            paused: { $sum: { $cond: ['$isPaused', 1, 0] } },
            stoppedByAdmin: {
              $sum: { $cond: [{ $eq: ['$pausedReason', PAUSED_REASONS.ADMIN] }, 1, 0] },
            },
            down: { $sum: { $cond: [{ $eq: ['$status', 'down'] }, 1, 0] } },
          },
        },
      ]);
      const byWorkspace = new Map(counts.map((row) => [String(row._id), row]));

      const rows = users.map((user) => {
        const mine = memberships.filter(
          (m) => String(m.userId) === String(user._id) && m.workspaceId,
        );
        const totals = { total: 0, running: 0, paused: 0, stoppedByAdmin: 0, down: 0 };
        for (const membership of mine) {
          if (!managed(user, membership)) continue;
          const c = byWorkspace.get(String(membership.workspaceId._id));
          if (!c) continue;
          totals.total += c.total;
          totals.running += c.total - c.paused;
          totals.paused += c.paused - c.stoppedByAdmin;
          totals.stoppedByAdmin += c.stoppedByAdmin;
          totals.down += c.down;
        }
        return {
          id: String(user._id),
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          lastSeenAt: lastSeen.get(String(user._id)) ?? null,
          providers: [...new Set((user.identities ?? []).map((identity) => identity.provider))],
          isDemo: isDemoUserEmail(user.email),
          workspaces: mine.map((membership) => ({
            id: String(membership.workspaceId._id),
            name: membership.workspaceId.name,
            role: membership.role,
            managed: managed(user, membership),
          })),
          monitors: totals,
        };
      });
      return { data: rows, pagination: { total, page, limit } };
    },

    /**
     * 'stop' pauses every running monitor in the user's managed workspaces (reason: admin);
     * 'start' resumes only the ones the admin stopped, never one the user paused themselves.
     */
    async setUserMonitors(userId, action) {
      if (!OBJECT_ID.test(userId)) throw notFound('User not found');
      const user = await User.findById(userId).select('email').lean();
      if (!user) throw notFound('User not found');

      const memberships = await Membership.find({ userId }).lean();
      const workspaceIds = memberships.filter((m) => managed(user, m)).map((m) => m.workspaceId);
      const list = await Monitor.find({ workspaceId: { $in: workspaceIds } }).lean();

      const result = { changed: 0, skipped: 0, failed: [] };
      for (const monitor of list) {
        const eligible =
          action === 'stop'
            ? !monitor.isPaused
            : monitor.isPaused && monitor.pausedReason === PAUSED_REASONS.ADMIN;
        if (!eligible) {
          result.skipped += 1;
          continue;
        }
        try {
          if (action === 'stop') {
            await monitors.pause(monitor.workspaceId, String(monitor._id), {
              reason: PAUSED_REASONS.ADMIN,
            });
          } else {
            await monitors.resume(monitor.workspaceId, String(monitor._id), { byAdmin: true });
          }
          result.changed += 1;
        } catch (error) {
          result.failed.push({ name: monitor.name, reason: error.message });
        }
      }
      return result;
    },
  };
}
