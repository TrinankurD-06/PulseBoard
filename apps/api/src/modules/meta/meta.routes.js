import { DEMO_USER_EMAIL, MAX_INTERVAL_SEC } from '@pulseboard/shared/constants';
import { Router } from 'express';

/** Public, non-secret runtime settings the client needs (e.g. for form limits). */
export function metaRouter({ env, schemas }) {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({
      data: {
        demoMode: env.DEMO_MODE,
        // The public demo account is a read-only Viewer; the client shows a banner for it.
        demoReadOnly: Boolean(env.DEMO_READ_ONLY),
        demoEmail: env.DEMO_READ_ONLY ? DEMO_USER_EMAIL : null,
        minIntervalSec: schemas.minIntervalSec,
        maxIntervalSec: MAX_INTERVAL_SEC,
      },
    });
  });
  return router;
}
