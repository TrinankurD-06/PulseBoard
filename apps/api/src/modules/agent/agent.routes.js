import { AGENT_REPORT_RATE_LIMIT } from '@pulseboard/shared/constants';
import { agentReportSchema } from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError, unauthorized } from '../../lib/errors.js';
import { hashAgentKey } from './agentKey.js';
import { createAgentService } from './agent.service.js';

/** The key from "Authorization: Bearer <key>", or null. */
function bearerKey(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  return match ? match[1] : null;
}

/**
 * Public endpoint for pulseboard-agent (U4):
 *
 *   POST /agent/report   Authorization: Bearer <agent key>   body: one report window
 *
 * No login: the agent key is the authentication. 401 for a missing or unknown
 * key, 400 for an invalid body, 429 above 30 reports a minute per key,
 * otherwise 202 { ok: true }. Body size is capped by the global JSON limit.
 */
export function agentRouter({ processCheckResult }) {
  const router = Router();
  const agents = createAgentService({ processCheckResult });

  const requireKey = (req, _res, next) => {
    req.agentKey = bearerKey(req);
    if (!req.agentKey) throw unauthorized('Missing agent key (Authorization: Bearer <key>)');
    next();
  };

  // Per key, not per IP: many app instances behind one NAT report fine, and a
  // leaked key can't be used to flood us. Keyed by the hash, never the raw key.
  const limitPerKey = rateLimit({
    windowMs: 60 * 1000,
    limit: AGENT_REPORT_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `agent:${hashAgentKey(req.agentKey)}`,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many reports for this agent key, slow down.')),
  });

  router.post('/report', requireKey, limitPerKey, async (req, res) => {
    const monitor = await agents.authenticate(req.agentKey);
    const report = agentReportSchema.parse(req.body ?? {});
    res.status(202).json(await agents.record(monitor, report));
  });

  return router;
}
