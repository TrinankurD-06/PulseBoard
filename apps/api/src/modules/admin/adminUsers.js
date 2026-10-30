import { PAUSED_REASONS, ROLES } from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import {
  AlertChannel,
  AlertLog,
  DailyRollup,
  Incident,
  Membership,
  Monitor,
  Session,
  User,
  Workspace,
} from '@pulseboard/shared/models';
import { AppError, notFound } from '../../lib/errors.js';
import { getWorkspaceUsage } from '../workspaces/usage.service.js';
import { deleteWorkspace } from '../workspaces/workspaces.service.js';
import {
  OBJECT_ID,
  assertNotAdminTarget,
  clampPage,
  idString,
  isManaged,
  loadMonitorContext,
  managedWorkspaceIds,
  monitorCountsByWorkspace,
  requireConfirmation,
  searchRegex,
} from './adminShared.js';
import { channelRow, incidentRow, monitorRow, userProfile } from './serializers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Users in the admin console. Writes return what they did; the route records the audit entry
 * BEFORE calling them, so an action whose log entry cannot be written does not run.
 */
export function createUsersAdmin({ monitors, scheduler, activeUser }) {
  async function load(id, select = '') {
    if (!OBJECT_ID.test(id)) throw notFound('User not found');
    const user = await User.findById(id)
      .select(
        `name email createdAt lastLoginAt platformRole suspendedAt suspendedReason identities.provider ${select}`,
      )
      .lean();
    if (!user) throw notFound('User not found');
    return user;
  }

  /** Pauses every running monitor in the user's managed workspaces, as the administrator. */
  async function pauseManaged(user, note) {
    const workspaceIds = await managedWorkspaceIds(user);
    const running = await Monitor.find({ workspaceId: { $in: workspaceIds }, isPaused: false })
      .select('workspaceId')
      .lean();
    let paused = 0;
    for (const monitor of running) {
      try {
        await monitors.pause(monitor.workspaceId, idString(monitor._id), {
          reason: PAUSED_REASONS.ADMIN,
          note,
        });
        paused += 1;
      } catch {
        // A monitor that vanished mid-way is simply not counted.
      }
    }
    return paused;
  }

  return {
    async list({ search, status = 'all', ...paging } = {}) {
      const { page, limit } = clampPage(paging);
      const filter = {};
      if (search?.trim()) {
        const rx = searchRegex(search);
        filter.$or = [{ name: rx }, { email: rx }];
      }
      if (status === 'suspended') filter.suspendedAt = { $ne: null };
      if (status === 'active') filter.suspendedAt = null;
      const [total, users] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .select('name email createdAt lastLoginAt platformRole suspendedAt identities.provider')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const memberships = await Membership.find({
        userId: { $in: users.map((u) => u._id) },
      }).lean();
      const workspaceIds = [
        ...new Map(memberships.map((m) => [idString(m.workspaceId), m.workspaceId])).values(),
      ];
      const counts = await monitorCountsByWorkspace(workspaceIds);

      const data = users.map((user) => {
        const mine = memberships.filter((m) => idString(m.userId) === idString(user._id));
        const monitorsCount = mine
          .filter((m) => isManaged(user, m))
          .reduce((sum, m) => sum + (counts.get(idString(m.workspaceId))?.total ?? 0), 0);
        return userProfile(user, { workspacesCount: mine.length, monitorsCount });
      });
      return { data, pagination: { total, page, limit } };
    },

    async detail(id) {
      const user = await load(id);
      const memberships = await Membership.find({ userId: user._id }).lean();
      const workspaceDocs = await Workspace.find({
        _id: { $in: memberships.map((m) => m.workspaceId) },
      })
        .select('name ownerId suspendedAt')
        .lean();
      const workspaceById = new Map(workspaceDocs.map((w) => [idString(w._id), w]));
      const managedIds = memberships.filter((m) => isManaged(user, m)).map((m) => m.workspaceId);
      const counts = await monitorCountsByWorkspace(memberships.map((m) => m.workspaceId));

      const monitorDocs = await Monitor.find({ workspaceId: { $in: managedIds } })
        .select(
          'name type url status isPaused pausedReason pauseNote workspaceId lastCheckedAt lastResponseMs lastOk',
        )
        .sort({ name: 1 })
        .limit(200)
        .lean();
      const context = await loadMonitorContext(monitorDocs);
      const monitorMap = new Map(monitorDocs.map((m) => [idString(m._id), m]));

      const incidentDocs = await Incident.find({ workspaceId: { $in: managedIds } })
        .select('monitorId workspaceId startedAt resolvedAt durationSec cause causeCode')
        .sort({ startedAt: -1 })
        .limit(50)
        .lean();
      const channels = await AlertChannel.find({ workspaceId: { $in: managedIds } })
        .select('workspaceId type name target isEnabled')
        .lean();

      const month = monthKey(new Date());
      const usages = await Promise.all(managedIds.map((wid) => getWorkspaceUsage(wid, month)));
      const cost = new Map();
      for (const usage of usages) {
        for (const row of usage.totals.costByCurrency) {
          cost.set(row.currency, (cost.get(row.currency) ?? 0) + row.actual);
        }
      }

      const since = new Date(Date.now() - 30 * DAY_MS);
      const [rollups, alertsSent30d, sessionsActive] = await Promise.all([
        DailyRollup.aggregate([
          { $match: { workspaceId: { $in: managedIds }, date: { $gte: since } } },
          {
            $group: {
              _id: null,
              checks: { $sum: '$totalChecks' },
              down: { $sum: '$downtimeSec' },
              covered: { $sum: '$coveredSec' },
            },
          },
        ]),
        AlertLog.countDocuments({
          workspaceId: { $in: managedIds },
          ok: true,
          at: { $gte: since },
        }),
        Session.countDocuments({
          userId: user._id,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        }),
      ]);
      const roll = rollups[0];

      return {
        profile: userProfile(user, {
          suspendedReason: user.suspendedReason ?? null,
          sessionsActive,
        }),
        workspaces: memberships.map((m) => {
          const workspace = workspaceById.get(idString(m.workspaceId));
          return {
            id: idString(m.workspaceId),
            name: workspace?.name ?? null,
            role: m.role,
            suspendedAt: workspace?.suspendedAt ?? null,
            monitorsCount: counts.get(idString(m.workspaceId))?.total ?? 0,
          };
        }),
        monitors: monitorDocs.map((m) => monitorRow(m, context.workspaces, context.owners)),
        incidents: incidentDocs.map((i) => incidentRow(i, monitorMap, context.workspaces)),
        alertChannels: channels.map((c) =>
          channelRow(c, workspaceById.get(idString(c.workspaceId))?.name),
        ),
        usage: {
          month,
          requests: usages.reduce((sum, u) => sum + u.totals.requests, 0),
          pings: usages.reduce((sum, u) => sum + u.totals.pings, 0),
          reports: usages.reduce((sum, u) => sum + u.totals.reports, 0),
          monthlyCost: [...cost.entries()]
            .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
            .sort((a, b) => a.currency.localeCompare(b.currency)),
        },
        analytics: {
          uptime30d:
            roll && roll.covered > 0
              ? Math.round((1 - roll.down / roll.covered) * 100 * 1000) / 1000
              : null,
          checks30d: roll?.checks ?? 0,
          alertsSent30d,
        },
      };
    },

    /** What an audit entry should say about the user before a write. */
    async snapshot(id) {
      const user = await load(id);
      return {
        email: user.email,
        suspended: Boolean(user.suspendedAt),
        platformRole: user.platformRole,
      };
    },

    async suspend(admin, id, reason) {
      const user = await load(id);
      assertNotAdminTarget(admin, user);
      await User.updateOne(
        { _id: user._id },
        { $set: { suspendedAt: new Date(), suspendedReason: reason } },
      );
      activeUser.forget(user._id);
      await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
      const pausedMonitors = await pauseManaged(user, `Account suspended: ${reason}`);
      return { ok: true, pausedMonitors };
    },

    async unsuspend(admin, id) {
      const user = await load(id);
      assertNotAdminTarget(admin, user);
      await User.updateOne(
        { _id: user._id },
        { $set: { suspendedAt: null, suspendedReason: null } },
      );
      activeUser.forget(user._id);
      return { ok: true };
    },

    async revokeSessions(admin, id) {
      const user = await load(id);
      assertNotAdminTarget(admin, user);
      const result = await Session.updateMany(
        { userId: user._id, revokedAt: null },
        { revokedAt: new Date() },
      );
      return { ok: true, revoked: result.modifiedCount };
    },

    /**
     * Deletes the account. Workspaces the user OWNS are either handed to `reassignTo`, or, in
     * 'cascade' mode, deleted when the user is the only member and handed to another existing
     * member otherwise: other people's monitors and data are never deleted with someone else's account.
     */
    async remove(admin, id, { confirm, mode, reassignTo }) {
      const user = await load(id);
      assertNotAdminTarget(admin, user);
      requireConfirmation(confirm?.toLowerCase?.(), user.email, "the user's email");

      let successor = null;
      if (mode === 'reassign') {
        if (!reassignTo || !OBJECT_ID.test(reassignTo) || reassignTo === idString(user._id)) {
          throw new AppError(400, 'BAD_REQUEST', 'Choose another user to receive their workspaces');
        }
        successor = await User.findById(reassignTo).select('suspendedAt').lean();
        if (!successor || successor.suspendedAt) {
          throw new AppError(
            400,
            'BAD_REQUEST',
            'The user receiving the workspaces must be active',
          );
        }
      }

      const owned = await Membership.find({ userId: user._id, role: ROLES.OWNER }).lean();
      let deletedWorkspaces = 0;
      let reassignedWorkspaces = 0;
      for (const membership of owned) {
        const wid = membership.workspaceId;
        const others = await Membership.find({ workspaceId: wid, userId: { $ne: user._id } })
          .sort({ role: 1, createdAt: 1 })
          .lean();
        let newOwnerId = null;
        if (successor) newOwnerId = successor._id;
        else if (others.length) {
          newOwnerId = (others.find((m) => m.role === ROLES.OWNER) ?? others[0]).userId;
        }
        if (!newOwnerId) {
          await deleteWorkspace(wid, scheduler);
          deletedWorkspaces += 1;
          continue;
        }
        await Membership.updateOne(
          { workspaceId: wid, userId: newOwnerId },
          { $set: { role: ROLES.OWNER } },
          { upsert: true },
        );
        await Workspace.updateOne({ _id: wid }, { $set: { ownerId: newOwnerId } });
        reassignedWorkspaces += 1;
      }
      await Promise.all([
        Membership.deleteMany({ userId: user._id }),
        Session.deleteMany({ userId: user._id }),
      ]);
      await User.deleteOne({ _id: user._id });
      activeUser.forget(user._id);
      return { ok: true, deletedWorkspaces, reassignedWorkspaces };
    },
  };
}
