import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const ALGORITHM = 'HS256';

/** SHA-256 of a refresh token. Only this hash is stored in the Session collection. */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Signs and verifies both token types. Access and refresh tokens use different
 * secrets, so a refresh token can never be accepted as an access token (and vice versa).
 */
export function createTokenService(env) {
  return {
    signAccessToken(userId) {
      return jwt.sign({ sub: String(userId) }, env.JWT_ACCESS_SECRET, {
        algorithm: ALGORITHM,
        expiresIn: env.ACCESS_TOKEN_TTL,
      });
    },

    /** Returns the user id, or null if the token is missing, invalid or expired. */
    verifyAccessToken(token) {
      try {
        return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] }).sub;
      } catch {
        return null;
      }
    },

    /** The random jwtid makes every refresh token unique, even two issued in the same second. */
    signRefreshToken(userId, familyId) {
      return jwt.sign({ sub: String(userId), fam: familyId }, env.JWT_REFRESH_SECRET, {
        algorithm: ALGORITHM,
        expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
        jwtid: randomUUID(),
      });
    },

    /** Returns { sub, fam } or null. */
    verifyRefreshToken(token) {
      try {
        return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [ALGORITHM] });
      } catch {
        return null;
      }
    },
  };
}
