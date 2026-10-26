import { MONITOR_STATUS, ROLES } from '@pulseboard/shared/constants';
import { paginationSchema } from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createMonitorService, toMonitorDto } from './monitors.service.js';

const listQuery = paginationSchema.extend({
  status: z.enum(Object.values(MONITOR_STATUS)).optional(),
});

/** Mounted under /workspaces/:wid/monitors. */
export function monitorsRouter({ env, scheduler, schemas }) {
  const router = Router({ mergeParams: true });
  const monitors = createMonitorService({ env, scheduler, schemas });
  const dto = (req, monitor) => toMonitorDto(monitor, req.membership.role);

  router.get('/', requireRole(ROLES.VIEWER), validate({ query: listQuery }), async (req, res) => {
    const result = await monitors.list(req.params.wid, req.valid.query);
    res.json({ ...result, data: result.data.map((monitor) => dto(req, monitor)) });
  });

  router.post(
    '/',
    requireRole(ROLES.MEMBER),
    validate({ body: schemas.create }),
    async (req, res) => {
      const monitor = await monitors.create(req.params.wid, req.valid.body);
      res.status(201).json({ data: dto(req, monitor) });
    },
  );

  router.get('/:mid', requireRole(ROLES.VIEWER), async (req, res) => {
    const monitor = await monitors.findInWorkspace(req.params.wid, req.params.mid);
    res.json({ data: dto(req, monitor) });
  });

  router.patch(
    '/:mid',
    requireRole(ROLES.MEMBER),
    validate({ body: schemas.update }),
    async (req, res) => {
      const monitor = await monitors.update(req.params.wid, req.params.mid, req.valid.body);
      res.json({ data: dto(req, monitor) });
    },
  );

  router.delete('/:mid', requireRole(ROLES.MEMBER), async (req, res) => {
    await monitors.remove(req.params.wid, req.params.mid);
    res.status(204).end();
  });

  router.post('/:mid/pause', requireRole(ROLES.MEMBER), async (req, res) => {
    res.json({ data: dto(req, await monitors.pause(req.params.wid, req.params.mid)) });
  });

  router.post('/:mid/resume', requireRole(ROLES.MEMBER), async (req, res) => {
    res.json({ data: dto(req, await monitors.resume(req.params.wid, req.params.mid)) });
  });

  return router;
}
