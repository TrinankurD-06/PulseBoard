import { User } from '@pulseboard/shared/models';
import { AppError } from '../lib/errors.js';

export const suspendedError = (reason) =>
  new AppError(
    403,
    'ACCOUNT_SUSPENDED',
    reason
      ? `This account has been suspended: ${reason}. Contact the administrator.`
      : 'This account has been suspended. Contact the administrator.',
    reason ? { reason } : undefined,
  );

/**
 * Refuses a signed-in user whose account an administrator suspended. A suspended user's access
 * token stays cryptographically valid until it expires, so this looks the user up (cached for a few
 * seconds) instead of trusting the token. Run it right after authenticate(). `forget(userId)` drops
 * the cache entry so a suspension takes effect on the next request.
 */
export function createActiveUserGuard({ ttlMs = 5000 } = {}) {
  const cache = new Map(); // userId -> { suspended, reason, expires }

  const guard = async (req, _res, next) => {
    const hit = cache.get(req.userId);
    let state = hit && hit.expires > Date.now() ? hit : null;
    if (!state) {
      const user = await User.findById(req.userId).select('suspendedAt suspendedReason').lean();
      state = {
        suspended: Boolean(user?.suspendedAt),
        reason: user?.suspendedReason ?? null,
        expires: Date.now() + ttlMs,
      };
      cache.set(req.userId, state);
      if (cache.size > 5000) cache.clear();
    }
    if (state.suspended) throw suspendedError(state.reason);
    next();
  };
  guard.forget = (userId) => cache.delete(String(userId));
  return guard;
}
