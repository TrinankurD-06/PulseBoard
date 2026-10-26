import { MAX_INTERVAL_SEC } from '@pulseboard/shared/constants';
import { Router } from 'express';

/** Public, non-secret runtime settings the client needs (e.g. for form limits). */
export function metaRouter({ env, schemas }) {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({
      data: {
        demoMode: env.DEMO_MODE,
        minIntervalSec: schemas.minIntervalSec,
        maxIntervalSec: MAX_INTERVAL_SEC,
      },
    });
  });
  return router;
}
