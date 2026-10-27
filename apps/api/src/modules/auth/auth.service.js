import { randomUUID } from 'node:crypto';
import { Membership, Session, User } from '@pulseboard/shared/models';
import bcrypt from 'bcrypt';
import { AppError, conflict, unauthorized } from '../../lib/errors.js';
import { hashToken } from '../../lib/tokens.js';
import { createWorkspaceWithOwner, toWorkspaceDto } from '../workspaces/workspaces.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const invalidSession = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please log in again.');

export function createAuthService({ env, tokens, logger }) {
  // Compared against when the email doesn't exist, so "unknown email" and
  // "wrong password" take the same time and can't be told apart (user enumeration).
  let dummyHashPromise;
  const dummyHash = () => (dummyHashPromise ??= bcrypt.hash(randomUUID(), env.BCRYPT_COST));

  /** Creates a Session for a new refresh token and returns both tokens. */
  async function issueTokens(userId, { familyId = randomUUID(), userAgent } = {}) {
    const refreshToken = tokens.signRefreshToken(userId, familyId);
    await Session.create({
      userId,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      userAgent: userAgent?.slice(0, 300),
    });
    return { accessToken: tokens.signAccessToken(userId), refreshToken };
  }

  /**
   * Creates a user, their personal workspace and the owner membership
   * atomically: a half-registered user without a workspace would land on an
   * empty app. Used by password registration and first OAuth sign-in.
   */
  async function createUserWithWorkspace(fields) {
    const session = await User.startSession();
    let user;
    try {
      await session.withTransaction(async () => {
        [user] = await User.create([fields], { session });
        await createWorkspaceWithOwner(
          { name: `${fields.name.split(' ')[0]}'s workspace`, ownerId: user._id },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return user;
  }

  /**
   * Finds or creates the user for a provider profile. Order: an already linked
   * identity wins; else a user with the same email is linked, but only when the
   * provider says the email is verified; else a new user is created. An
   * unverified email never links or creates anything.
   */
  async function resolveOAuthUser(provider, profile) {
    const thisIdentity = { $elemMatch: { provider, providerId: profile.providerId } };
    const linked = await User.findOne({ identities: thisIdentity });
    if (linked) return linked;

    if (!profile.email || !profile.emailVerified) {
      throw new AppError(403, 'OAUTH_EMAIL_UNVERIFIED', 'The provider has not verified this email');
    }
    const identity = { provider, providerId: profile.providerId, email: profile.email };

    // The $not guard keeps a concurrent second callback from linking the same account twice.
    const existing = await User.findOneAndUpdate(
      { email: profile.email, identities: { $not: thisIdentity } },
      { $push: { identities: { ...identity, linkedAt: new Date() } } },
      { returnDocument: 'after' },
    );
    if (existing) return existing;
    const raced = await User.findOne({ identities: thisIdentity });
    if (raced) return raced;

    const name = (profile.name?.trim() || profile.email.split('@')[0]).slice(0, 80);
    return createUserWithWorkspace({ name, email: profile.email, identities: [identity] });
  }

  async function revokeFamily(familyId) {
    await Session.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
  }

  return {
    async register({ name, email, password }, meta) {
      if (await User.exists({ email })) {
        throw conflict('An account with this email already exists', { fields: ['email'] });
      }
      const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
      const user = await createUserWithWorkspace({ name, email, passwordHash });
      return { user, ...(await issueTokens(user._id, meta)) };
    },

    async login({ email, password }, meta) {
      const user = await User.findOne({ email }).select('+passwordHash');
      // A user who signed up with Google/GitHub has no hash: they are compared
      // against the dummy hash too, so they get the same generic error.
      const matches = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash()));
      if (!user || !matches) throw invalidCredentials();
      return { user, ...(await issueTokens(user._id, meta)) };
    },

    /**
     * Refresh-token rotation: each refresh token works exactly once. Using it
     * revokes it and issues a new one in the same family. Presenting a token
     * that was already used means it was copied (stolen), or a race, so the
     * whole family is revoked and the user must log in again.
     */
    async refresh(refreshToken, meta) {
      const payload = refreshToken && tokens.verifyRefreshToken(refreshToken);
      if (!payload) throw invalidSession();

      const session = await Session.findOne({ tokenHash: hashToken(refreshToken) });
      if (!session) throw invalidSession();

      // Atomic claim: only one request can flip revokedAt from null, so two
      // concurrent refreshes with the same token can't both succeed.
      const claimed = await Session.findOneAndUpdate(
        { _id: session._id, revokedAt: null },
        { revokedAt: new Date() },
      );
      if (!claimed) {
        logger.warn({ userId: session.userId, familyId: session.familyId }, 'Refresh token reuse');
        await revokeFamily(session.familyId);
        throw invalidSession();
      }

      if (!(await User.exists({ _id: session.userId }))) throw invalidSession();
      return issueTokens(session.userId, { ...meta, familyId: session.familyId });
    },

    async logout(refreshToken) {
      if (!refreshToken) return;
      await Session.updateOne(
        { tokenHash: hashToken(refreshToken), revokedAt: null },
        { revokedAt: new Date() },
      );
    },

    /** Signs in (or up) with a verified provider profile; same tokens as login. */
    async oauthSignIn(provider, profile, meta) {
      const user = await resolveOAuthUser(provider, profile);
      return { user, ...(await issueTokens(user._id, meta)) };
    },

    async me(userId) {
      // passwordHash is loaded only so toJSON can report hasPassword; it is never serialised.
      const user = await User.findById(userId).select('+passwordHash');
      if (!user) throw unauthorized('User no longer exists');
      const memberships = await Membership.find({ userId })
        .sort({ createdAt: 1 })
        .populate('workspaceId');
      const workspaces = memberships
        .filter((membership) => membership.workspaceId)
        .map((membership) => toWorkspaceDto(membership.workspaceId, membership.role));
      return { user, workspaces };
    },
  };
}
