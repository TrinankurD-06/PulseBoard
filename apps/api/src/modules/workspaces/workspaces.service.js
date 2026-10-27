import { ROLES } from '@pulseboard/shared/constants';
import {
  AgentReport,
  AlertChannel,
  CheckResult,
  DailyRollup,
  Incident,
  Membership,
  Monitor,
  MonitorUsage,
  StatusPage,
  Workspace,
} from '@pulseboard/shared/models';
import { notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';
import { uniqueSlug } from '../../lib/slug.js';

/** Shape returned to the client: the workspace plus the caller's role in it. */
export function toWorkspaceDto(workspace, role) {
  return { ...workspace.toJSON(), role };
}

/**
 * Creates a workspace and its owner membership. Pass a Mongo session to run
 * this inside a caller's transaction (registration does).
 */
export async function createWorkspaceWithOwner({ name, ownerId }, session) {
  const [workspace] = await Workspace.create([{ name, slug: uniqueSlug(name), ownerId }], {
    session,
  });
  await Membership.create([{ workspaceId: workspace._id, userId: ownerId, role: ROLES.OWNER }], {
    session,
  });
  return workspace;
}

export async function createWorkspace({ name, userId }) {
  const session = await Workspace.startSession();
  try {
    const workspace = await session.withTransaction(() =>
      createWorkspaceWithOwner({ name, ownerId: userId }, session),
    );
    return toWorkspaceDto(workspace, ROLES.OWNER);
  } finally {
    await session.endSession();
  }
}

/** Workspaces the user belongs to, with their role, oldest membership first. */
export async function listWorkspacesForUser(userId, pagination) {
  const result = await paginate(Membership, { userId }, pagination, (query) =>
    query.sort({ createdAt: 1 }).populate('workspaceId'),
  );
  return {
    ...result,
    data: result.data
      .filter((membership) => membership.workspaceId) // skip dangling memberships
      .map((membership) => toWorkspaceDto(membership.workspaceId, membership.role)),
  };
}

export async function getWorkspace(workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) throw notFound('Workspace not found');
  return workspace;
}

export async function renameWorkspace(workspaceId, name) {
  const workspace = await Workspace.findByIdAndUpdate(
    workspaceId,
    { name },
    { returnDocument: 'after', runValidators: true },
  );
  if (!workspace) throw notFound('Workspace not found');
  return workspace;
}

/**
 * Deletes a workspace and everything in it. Children go first and the workspace
 * document last, so if a step fails the workspace still exists and the delete can
 * simply be retried. (Time-series collections can't be written inside a
 * transaction, so a single transaction isn't an option here.)
 * Check jobs are cancelled first, so the worker stops touching these monitors.
 */
export async function deleteWorkspace(workspaceId, scheduler) {
  const monitorIds = await Monitor.find({ workspaceId }).distinct('_id');
  await Promise.all(monitorIds.map((id) => scheduler.cancelMonitor(id)));

  await Promise.all([
    Monitor.deleteMany({ workspaceId }),
    CheckResult.deleteMany({ 'meta.workspaceId': workspaceId }),
    AgentReport.deleteMany({ 'meta.workspaceId': workspaceId }),
    MonitorUsage.deleteMany({ workspaceId }),
    DailyRollup.deleteMany({ workspaceId }),
    Incident.deleteMany({ workspaceId }),
    AlertChannel.deleteMany({ workspaceId }),
    StatusPage.deleteMany({ workspaceId }),
  ]);
  await Membership.deleteMany({ workspaceId });
  await Workspace.deleteOne({ _id: workspaceId });
}
