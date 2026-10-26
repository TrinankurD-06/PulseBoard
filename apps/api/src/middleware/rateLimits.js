import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Counters live in process memory. That's correct for a single API instance;
// several instances would each count separately (see DECISIONS.md).
function limiter({ windowMs, limit, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });
}

/** Brute-force protection for login/register, per client IP. */
export function createAuthLimiter(max) {
  return limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: max,
    message: 'Too many attempts. Please try again in a few minutes.',
  });
}

/**
 * "Test now" makes our server send a real HTTP request, so it's limited per
 * *user* (not IP): 5 per minute. Must run after authenticate().
 */
export function createTestCheckLimiter() {
  return limiter({
    windowMs: 60 * 1000,
    limit: 5,
    message: 'You can run 5 test checks per minute. Please wait a moment.',
    keyGenerator: (req) => `user:${req.userId}`,
  });
}

/** "Send test alert" posts to a real webhook/inbox: 5 per minute per user. */
export function createTestAlertLimiter() {
  return limiter({
    windowMs: 60 * 1000,
    limit: 5,
    message: 'You can send 5 test alerts per minute. Please wait a moment.',
    keyGenerator: (req) => `user:${req.userId}`,
  });
}

/** Refresh is called automatically by the client, so it gets a looser limit. */
export function createRefreshLimiter(max) {
  return limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: max * 3,
    message: 'Too many session refreshes. Please try again shortly.',
  });
}
