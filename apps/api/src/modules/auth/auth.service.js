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

  async function revokeFamily(familyId) {
    await Session.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
  }

  return {
    async register({ name, email, password }, meta) {
      if (await User.exists({ email })) {
        throw conflict('An account with this email already exists', { fields: ['email'] });
      }
      const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);

      // User, personal workspace and owner membership are created atomically:
      // a half-registered user without a workspace would land on an empty app.
      const session = await User.startSession();
      let user;
      try {
        await session.withTransaction(async () => {
          [user] = await User.create([{ name, email, passwordHash }], { session });
          await createWorkspaceWithOwner(
            { name: `${name.split(' ')[0]}'s workspace`, ownerId: user._id },
            session,
          );
        });
      } finally {
        await session.endSession();
      }

      return { user, ...(await issueTokens(user._id, meta)) };
    },

    async login({ email, password }, meta) {
      const user = await User.findOne({ email }).select('+passwordHash');
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

    async me(userId) {
      const user = await User.findById(userId);
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
