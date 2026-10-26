import { Router } from 'express';
import { mongoState } from '@pulseboard/shared/db';

/**
 * Health check for load balancers and Render. Reports the MongoDB connection
 * and the state of each change stream. Returns 503 when the API cannot serve.
 */
export function healthRouter({ getRealtimeStatus = () => 'not_started' } = {}) {
  const router = Router();

  router.get('/', (_req, res) => {
    const mongo = mongoState();
    const changeStreams = getRealtimeStatus();
    const streamsLive =
      typeof changeStreams === 'object' &&
      Object.values(changeStreams).every((state) => state === 'live');
    // Without MongoDB nothing works (503). Without change streams the API still
    // serves requests; only live updates are affected, so it's 'degraded' (200).
    const healthy = mongo === 'connected';
    res.status(healthy ? 200 : 503).json({
      status: healthy && streamsLive ? 'ok' : 'degraded',
      mongo,
      changeStreams,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  return router;
}
