import { PLATFORM_ROLES } from '@pulseboard/shared/constants';
import { isDemoUserEmail } from '@pulseboard/shared/demo';
import { User } from '@pulseboard/shared/models';
import bcrypt from 'bcrypt';
import { createWorkspaceWithOwner } from '../workspaces/workspaces.service.js';

export const MIN_ADMIN_PASSWORD_LENGTH = 8;

/**
 * How superadmins come to exist. There is deliberately no API and no screen that promotes anyone:
 * only these server-side paths do.
 *  1. ADMIN_EMAILS (and the single ADMIN_EMAIL), applied when the API starts, to existing accounts;
 *  2. ADMIN_EMAIL + ADMIN_PASSWORD, which also CREATES that account if it is missing (so the
 *     evaluation login in the README works) and keeps its password in line with the variable;
 *  3. \`npm run admin:grant -- email\` / \`admin:revoke\`.
 * The public demo account can never be a superadmin, by any of them.
 */

const normalise = (email) =>
  String(email ?? '')
    .trim()
    .toLowerCase();

/** Makes `email` a superadmin. Returns 'granted' | 'already' | 'missing' | 'demo'. */
export async function grantSuperadmin(email) {
  const address = normalise(email);
  if (isDemoUserEmail(address)) return 'demo';
  const user = await User.findOne({ email: address }).select('platformRole').lean();
  if (!user) return 'missing';
  if (user.platformRole === PLATFORM_ROLES.SUPERADMIN) return 'already';
  await User.updateOne({ _id: user._id }, { $set: { platformRole: PLATFORM_ROLES.SUPERADMIN } });
  return 'granted';
}

/** Removes the superadmin role from `email`. Returns 'revoked' | 'not-admin' | 'missing'. */
export async function revokeSuperadmin(email) {
  const user = await User.findOne({ email: normalise(email) })
    .select('platformRole')
    .lean();
  if (!user) return 'missing';
  if (user.platformRole !== PLATFORM_ROLES.SUPERADMIN) return 'not-admin';
  await User.updateOne({ _id: user._id }, { $set: { platformRole: PLATFORM_ROLES.USER } });
  return 'revoked';
}

/**
 * Creates the account named by ADMIN_EMAIL from ADMIN_PASSWORD, or brings its password in line with
 * the variable. Does nothing unless both are set. Returns 'disabled' | 'weak-password' |
 * 'demo' | 'created' | 'updated' | 'unchanged'. (It does not grant the role: bootstrapSuperadmins does.)
 */
export async function ensureAdminAccount({ env, logger, bcryptCost = env.BCRYPT_COST }) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return 'disabled';
  if (isDemoUserEmail(env.ADMIN_EMAIL)) {
    logger?.warn('ADMIN_EMAIL is the demo account, which can never be an administrator: ignored');
    return 'demo';
  }
  if (env.ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH) {
    logger?.warn(
      `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters: the admin account was not created or updated`,
    );
    return 'weak-password';
  }
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
 * Start-up: make the ADMIN_EMAIL account if asked to, then grant superadmin to every address in
 * ADMIN_EMAILS and to ADMIN_EMAIL. Addresses without an account are reported, not created.
 */
export async function bootstrapSuperadmins({ env, logger }) {
  const account = await ensureAdminAccount({ env, logger });
  const wanted = [
    ...new Set([...(env.ADMIN_EMAILS ?? []), ...(env.ADMIN_EMAIL ? [env.ADMIN_EMAIL] : [])]),
  ];
  const result = { account, granted: [], missing: [], skippedDemo: [] };
  for (const email of wanted) {
    const state = await grantSuperadmin(email);
    if (state === 'granted' || state === 'already') result.granted.push(email);
    else if (state === 'missing') result.missing.push(email);
    else if (state === 'demo') result.skippedDemo.push(email);
  }
  if (result.missing.length) {
    logger?.warn(
      { missing: result.missing },
      'ADMIN_EMAILS lists addresses with no account yet: sign up first, then restart',
    );
  }
  if (result.skippedDemo.length)
    logger?.warn('The demo account cannot be an administrator: ignored');
  if (!wanted.length) logger?.info('No administrator configured: the admin console is off');
  return result;
}
