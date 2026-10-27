import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../lib/errors.js';
import { createPingService, PING_KINDS } from './ping.service.js';

const PINGS_PER_MINUTE = 60;

/**
 * Public heartbeat endpoints: the customer's cron job / worker calls them.
 * No login: the secret token in the URL is the authentication.
 *
 *   GET|POST /ping/:token         the job ran successfully
 *   GET|POST /ping/:token/fail    the job ran and failed (?message=... or {"message"})
 *   GET|POST /ping/:token/start   the job started (the next ping then reports its duration)
 *
 * Responses only ever say { ok: true } (or an error), never anything about the monitor.
 */
export function pingRouter({ processCheckResult }) {
  const router = Router();
  const pings = createPingService({ processCheckResult });

  // Per token, not per IP: one misbehaving job can't lock out others behind
  // the same NAT, and a leaked token can't be used to flood us.
  const limitPerToken = rateLimit({
    windowMs: 60 * 1000,
    limit: PINGS_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `ping:${req.params.token}`,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many pings for this monitor, slow down.')),
  });

  const handle = (kind) => async (req, res) => {
    const message = req.query.message ?? req.body?.message;
    res.json(await pings.record(req.params.token, kind, { message }));
  };

  for (const [path, kind] of [
    ['/:token', PING_KINDS.SUCCESS],
    ['/:token/fail', PING_KINDS.FAIL],
    ['/:token/start', PING_KINDS.START],
  ]) {
    router.route(path).get(limitPerToken, handle(kind)).post(limitPerToken, handle(kind));
  }

  return router;
}
