import { PAUSED_REASONS, ROLES } from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import {
  Incident,
  Membership,
  Monitor,
  StatusPage,
  User,
  Workspace,
} from '@pulseboard/shared/models';
import { AppError, notFound } from '../../lib/errors.js';
import { getWorkspaceUsage } from '../workspaces/usage.service.js';
import { deleteWorkspace } from '../workspaces/workspaces.service.js';
import {
  OBJECT_ID,
  clampPage,
  idString,
  loadMonitorContext,
  monitorCountsByWorkspace,
  requireConfirmation,
  searchRegex,
} from './adminShared.js';
import { incidentRow, monitorRow } from './serializers.js';

/** Workspaces (organisations) in the admin console. */
export function createWorkspacesAdmin({ monitors, scheduler }) {
  async function load(id) {
    if (!OBJECT_ID.test(id)) throw notFound('Workspace not found');
    const workspace = await Workspace.findById(id).lean();
    if (!workspace) throw notFound('Workspace not found');
    return workspace;
  }

  return {
    async list({ search, status = 'all', ...paging } = {}) {
      const { page, limit } = clampPage(paging);
      const filter = {};
      if (search?.trim()) filter.name = searchRegex(search);
      if (status === 'suspended') filter.suspendedAt = { $ne: null };
      if (status === 'active') filter.suspendedAt = null;
      const [total, rows] = await Promise.all([
        Workspace.countDocuments(filter),
        Workspace.find(filter)
          .select('name slug ownerId createdAt suspendedAt')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const ids = rows.map((w) => w._id);
      const [owners, memberCounts, monitorCounts, openIncidents] = await Promise.all([
        User.find({ _id: { $in: rows.map((w) => w.ownerId) } })
          .select('name email')
          .lean(),
        Membership.aggregate([
          { $match: { workspaceId: { $in: ids } } },
          { $group: { _id: '$workspaceId', n: { $sum: 1 } } },
        ]),
        monitorCountsByWorkspace(ids),
        Incident.aggregate([
          { $match: { workspaceId: { $in: ids }, resolvedAt: null } },
          { $group: { _id: '$workspaceId', n: { $sum: 1 } } },
        ]),
      ]);
      const ownerById = new Map(owners.map((u) => [idString(u._id), u]));
      const members = new Map(memberCounts.map((r) => [idString(r._id), r.n]));
      const open = new Map(openIncidents.map((r) => [idString(r._id), r.n]));
      return {
        data: rows.map((w) => {
          const owner = ownerById.get(idString(w.ownerId));
          return {
            id: idString(w._id),
            name: w.name,
            slug: w.slug,
            owner: owner ? { id: idString(owner._id), name: owner.name, email: owner.email } : null,
            createdAt: w.createdAt,
            suspendedAt: w.suspendedAt ?? null,
            membersCount: members.get(idString(w._id)) ?? 0,
            monitorsCount: monitorCounts.get(idString(w._id))?.total ?? 0,
            openIncidents: open.get(idString(w._id)) ?? 0,
          };
        }),
        pagination: { total, page, limit },
      };
    },

    async detail(id) {
      const workspace = await load(id);
      const [memberships, monitorDocs, pages, incidentDocs, usage] = await Promise.all([
        Membership.find({ workspaceId: workspace._id }).sort({ createdAt: 1 }).lean(),
        Monitor.find({ workspaceId: workspace._id })
          .select(
            'name type url status isPaused pausedReason pauseNote workspaceId lastCheckedAt lastResponseMs lastOk',
          )
          .sort({ name: 1 })
          .lean(),
        StatusPage.find({ workspaceId: workspace._id })
          .select('slug title isPublic monitorIds')
          .lean(),
        Incident.find({ workspaceId: workspace._id })
          .select('monitorId workspaceId startedAt resolvedAt durationSec cause causeCode')
          .sort({ startedAt: -1 })
          .limit(50)
          .lean(),
        getWorkspaceUsage(workspace._id, monthKey(new Date())),
      ]);
      const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
        .select('name email')
        .lean();
      const userById = new Map(users.map((u) => [idString(u._id), u]));
      const context = await loadMonitorContext(monitorDocs);
      const monitorMap = new Map(monitorDocs.map((m) => [idString(m._id), m]));
      return {
        workspace: {
          id: idString(workspace._id),
          name: workspace.name,
          slug: workspace.slug,
          createdAt: workspace.createdAt,
          suspendedAt: workspace.suspendedAt ?? null,
          suspendedReason: workspace.suspendedReason ?? null,
        },
        members: memberships.map((m) => {
          const user = userById.get(idString(m.userId));
          return {
            userId: idString(m.userId),
            name: user?.name ?? null,
            email: user?.email ?? null,
            role: m.role,
          };
        }),
        monitors: monitorDocs.map((m) => monitorRow(m, context.workspaces, context.owners)),
        statusPages: pages.map((p) => ({
          id: idString(p._id),
          slug: p.slug,
          title: p.title,
          isPublic: Boolean(p.isPublic),
          monitorsCount: p.monitorIds.length,
        })),
        incidents: incidentDocs.map((i) => incidentRow(i, monitorMap, context.workspaces)),
        usage: {
          month: usage.month,
          requests: usage.totals.requests,
          pings: usage.totals.pings,
          reports: usage.totals.reports,
          monthlyCost: usage.totals.costByCurrency.map((row) => ({
            currency: row.currency,
            amount: row.actual,
          })),
        },
      };
    },

    async snapshot(id) {
      const workspace = await load(id);
      return {
        name: workspace.name,
        ownerId: idString(workspace.ownerId),
        suspended: Boolean(workspace.suspendedAt),
      };
    },

    /** The new owner must already be a member; the previous owner stays on as a member. */
    async transfer(id, newOwnerId) {
      const workspace = await load(id);
      if (!OBJECT_ID.test(newOwnerId ?? '')) {
        throw new AppError(400, 'BAD_REQUEST', 'Choose a member to receive the workspace');
      }
      const membership = await Membership.findOne({
        workspaceId: workspace._id,
        userId: newOwnerId,
      });
      if (!membership) {
        throw new AppError(
          400,
          'BAD_REQUEST',
          'The new owner must already be a member of the workspace',
        );
      }
      if (idString(workspace.ownerId) === newOwnerId) return { ok: true, unchanged: true };
      await Membership.updateOne({ _id: membership._id }, { $set: { role: ROLES.OWNER } });
      await Membership.updateOne(
        { workspaceId: workspace._id, userId: workspace.ownerId },
        { $set: { role: ROLES.MEMBER } },
      );
      await Workspace.updateOne({ _id: workspace._id }, { $set: { ownerId: newOwnerId } });
      return { ok: true };
    },

    async suspend(id, reason) {
      const workspace = await load(id);
      await Workspace.updateOne(
        { _id: workspace._id },
        { $set: { suspendedAt: new Date(), suspendedReason: reason } },
      );
      const running = await Monitor.find({ workspaceId: workspace._id, isPaused: false })
        .select('_id')
        .lean();
      let pausedMonitors = 0;
      for (const monitor of running) {
        try {
          await monitors.pause(workspace._id, idString(monitor._id), {
            reason: PAUSED_REASONS.ADMIN,
            note: `Workspace suspended: ${reason}`,
          });
          pausedMonitors += 1;
        } catch {
          // gone in the meantime
        }
      }
      return { ok: true, pausedMonitors };
    },

    async unsuspend(id) {
      const workspace = await load(id);
      await Workspace.updateOne(
        { _id: workspace._id },
        { $set: { suspendedAt: null, suspendedReason: null } },
      );
      return { ok: true };
    },

    async remove(id, { confirm }) {
      const workspace = await load(id);
      requireConfirmation(confirm, workspace.name, "the workspace's name");
      await deleteWorkspace(workspace._id, scheduler);
      return { ok: true };
    },
  };
}
