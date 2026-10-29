// The demo account half of `npm run seed`, importable so it can be tested against an
// in-memory database.
import { DEMO_USER_EMAIL, ROLES } from '@pulseboard/shared/constants';
import { Membership, Session, User } from '@pulseboard/shared/models';
import { deleteWorkspace } from '../../src/modules/workspaces/workspaces.service.js';

/**
 * Removes the previous demo account and its workspaces. A workspace counts as the demo's when
 * the demo user owns it or, with `readOnly`, is a Viewer in it (the read-only demo is a Viewer
 * of a workspace owned by another account), so re-seeding never leaves a duplicate.
 * Returns the number of workspaces deleted, or -1 when there was no demo account.
 */
export async function removePreviousDemo({ scheduler, readOnly = false, log = console.warn }) {
  const user = await User.findOne({ email: DEMO_USER_EMAIL });
  if (!user) return -1;
  const roles = readOnly ? [ROLES.OWNER, ROLES.VIEWER] : [ROLES.OWNER];
  const owned = await Membership.find({ userId: user._id, role: { $in: roles } }).lean();
  for (const { workspaceId } of owned) await deleteWorkspace(workspaceId, scheduler);
  await Promise.all([
    Membership.deleteMany({ userId: user._id }),
    Session.deleteMany({ userId: user._id }),
    user.deleteOne(),
  ]);
  log('Removed the previous demo account and its data.');
  return owned.length;
}
