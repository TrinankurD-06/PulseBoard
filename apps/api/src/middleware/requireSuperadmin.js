import { PLATFORM_ROLES } from '@pulseboard/shared/constants';
import { isDemoUserEmail } from '@pulseboard/shared/demo';
import { User } from '@pulseboard/shared/models';
import { forbidden } from '../lib/errors.js';

/**
 * Can this user (a document with email, platformRole, suspendedAt) act as a platform administrator?
 * Superadmin by role, not suspended, and never the public demo account, whatever its role says.
 */
export function isSuperadminUser(user) {
  return Boolean(
    user &&
    user.platformRole === PLATFORM_ROLES.SUPERADMIN &&
    !user.suspendedAt &&
    !isDemoUserEmail(user.email),
  );
}

/** Loads a user's admin standing from the database (never from the token). */
export async function loadAdminStanding(userId) {
  const user = await User.findById(userId).select('email platformRole suspendedAt').lean();
  return isSuperadminUser(user) ? { id: String(user._id), email: user.email } : null;
}

/**
 * Guards every /admin route. Must run after authenticate(). The role is read from the database on
 * every request, so removing someone's role (or suspending them) takes effect at once even though
 * their access token is still valid. Everyone else gets 403. Sets req.admin = { id, email }.
 */
export function requireSuperadmin() {
  return async (req, _res, next) => {
    const admin = await loadAdminStanding(req.userId);
    if (!admin) throw forbidden('Administrator access required');
    req.admin = admin;
    next();
  };
}
