import { Router } from 'express';
import { mongoState } from '@pulseboard/shared/db';

/**
 * Health check for load balancers and Render. Reports MongoDB connection and
 * (from phase 6) change-stream status. Returns 503 when the API cannot serve.
 */
export function healthRouter({ getRealtimeStatus = () => 'not_started' } = {}) {
  const router = Router();

  router.get('/', (_req, res) => {
    const mongo = mongoState();
    const healthy = mongo === 'connected';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      mongo,
      changeStreams: getRealtimeStatus(),
      uptimeSec: Math.round(process.uptime()),
    });
  });

  return router;
}
