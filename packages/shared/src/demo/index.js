// The public demo account: keeping it harmless, and resetting what it shows.
//
// With DEMO_READ_ONLY the demo user (demo@pulseboard.dev, whose password is on the login
// page) is a Viewer: the existing RBAC then refuses every create, edit and delete, and hides
// secrets. A workspace needs an owner, so a separate owner account is created for it, one with
// no password, so nobody can log in as it (or an existing account named by DEMO_OWNER_EMAIL).
import { DEMO_OWNER_DEFAULT_EMAIL, DEMO_USER_EMAIL, ROLES } from '../constants.js';
import { Membership, Monitor, StatusPage, User, Workspace } from '../models/index.js';
import { addDemoIncidentMonitor, DEMO_MONITOR_NAME } from './demoIncidents.js';

export { addDemoIncidentMonitor, DEMO_INCIDENTS, DEMO_MONITOR_NAME } from './demoIncidents.js';

/** True when `email` is the public demo account (compared case-insensitively). */
export const isDemoUserEmail = (email) =>
  typeof email === 'string' && email.trim().toLowerCase() === DEMO_USER_EMAIL;

async function findOrCreateOwner(ownerEmail) {
  let email = (ownerEmail || DEMO_OWNER_DEFAULT_EMAIL).toLowerCase();
  // The demo user itself can never be its own owner: it is about to become a Viewer.
  if (email === DEMO_USER_EMAIL) email = DEMO_OWNER_DEFAULT_EMAIL;
  const existing = await User.findOne({ email });
  if (existing) return existing;
  // No passwordHash: password login is impossible, like an account that only signs in with OAuth.
  return User.create({ name: 'Demo Owner', email });
}

/**
 * Makes sure the demo user is a Viewer in every workspace it belongs to. Where it was the owner,
 * the owner account becomes owner first, so a workspace is never left without one. Safe to run
 * any number of times; does nothing when there is no demo user.
 */
export async function ensureReadOnlyDemo({ ownerEmail, logger } = {}) {
  const demo = await User.findOne({ email: DEMO_USER_EMAIL }, { _id: 1 }).lean();
  if (!demo) return { demoUser: false, demoted: 0, workspaceIds: [] };

  const memberships = await Membership.find({ userId: demo._id }).lean();
  let owner = null;
  let demoted = 0;
  for (const membership of memberships) {
    if (membership.role === ROLES.VIEWER) continue;
    if (membership.role === ROLES.OWNER) {
      const otherOwner = await Membership.exists({
        workspaceId: membership.workspaceId,
        role: ROLES.OWNER,
        userId: { $ne: demo._id },
      });
      if (!otherOwner) {
        owner ??= await findOrCreateOwner(ownerEmail);
        await Membership.updateOne(
          { workspaceId: membership.workspaceId, userId: owner._id },
          { $set: { role: ROLES.OWNER } },
          { upsert: true },
        );
        await Workspace.updateOne(
          { _id: membership.workspaceId },
          { $set: { ownerId: owner._id } },
        );
      }
    }
    await Membership.updateOne({ _id: membership._id }, { $set: { role: ROLES.VIEWER } });
    demoted += 1;
  }
  const workspaceIds = memberships.map((membership) => membership.workspaceId);
  if (demoted > 0) logger?.info({ demoted }, 'Demo user set to read-only (Viewer)');
  return { demoUser: true, demoted, workspaceIds };
}

/**
 * Daily reset of the public demo: re-applies the read-only role, then rebuilds the sample
 * "Demo Checkout API" monitor (incident history, checks, rollups, usage) so its dates are
 * recent again, keeping it on any status page that listed it. Real monitors, users and
 * channels are never touched. Returns { demoUser, demoted, refreshed }.
 */
export async function resetDemoData({ ownerEmail, now = Date.now(), logger } = {}) {
  const safety = await ensureReadOnlyDemo({ ownerEmail, logger });
  if (!safety.demoUser) return { ...safety, refreshed: 0 };

  let refreshed = 0;
  for (const workspaceId of safety.workspaceIds) {
    const old = await Monitor.find(
      { workspaceId, name: DEMO_MONITOR_NAME, isSeed: true },
      { _id: 1 },
    ).lean();
    if (old.length === 0) continue;
    const oldIds = old.map((monitor) => monitor._id);
    const pages = await StatusPage.find({ workspaceId, monitorIds: { $in: oldIds } }, { _id: 1 });

    const { monitor } = await addDemoIncidentMonitor({ workspaceId, now });
    for (const page of pages) {
      await StatusPage.updateOne({ _id: page._id }, { $pull: { monitorIds: { $in: oldIds } } });
      await StatusPage.updateOne({ _id: page._id }, { $addToSet: { monitorIds: monitor._id } });
    }
    refreshed += 1;
  }
  if (refreshed > 0) logger?.info({ refreshed }, 'Demo data reset');
  return { ...safety, refreshed };
}
