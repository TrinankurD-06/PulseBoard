import { User } from '@pulseboard/shared/models';
import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { createMonitorService } from '../monitors/monitors.service.js';
import { createAdminService, isAdminEmail } from './admin.service.js';

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const actionBody = z.object({ action: z.enum(['stop', 'start']) });

/**
 * The admin panel API, mounted under /admin after authenticate. Everything answers 404 unless the
 * signed-in user is the administrator (ADMIN_EMAIL), so the panel does not reveal that it exists.
 *
 *   GET  /admin/users?search=&page=&limit=   every user, their workspaces and monitor counts
 *   POST /admin/users/:uid/monitors          { action: 'stop' | 'start' }
 */
export function adminRouter({ env, scheduler, schemas }) {
  const router = Router();
  const admin = createAdminService({ monitors: createMonitorService({ env, scheduler, schemas }) });

  router.use(async (req, _res, next) => {
    const user = await User.findById(req.userId).select('email').lean();
    if (!isAdminEmail(env, user?.email)) throw notFound('Not found');
    next();
  });

  router.get('/users', validate({ query: listQuery }), async (req, res) => {
    res.json(await admin.listUsers(req.valid.query));
  });

  router.post('/users/:uid/monitors', validate({ body: actionBody }), async (req, res) => {
    const result = await admin.setUserMonitors(req.params.uid, req.valid.body.action);
    res.json({ data: result });
  });

  return router;
}
