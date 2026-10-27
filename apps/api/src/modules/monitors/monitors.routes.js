import { MONITOR_STATUS, MONITOR_TYPES, ROLES } from '@pulseboard/shared/constants';
import { monitorTypeSchema, paginationSchema } from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createTestCheckLimiter } from '../../middleware/rateLimits.js';
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

  // The body schema depends on the requested type (absent = http, as before).
  const validateCreate = (req, res, next) => {
    const type = monitorTypeSchema.parse(req.body?.type);
    const body = type === MONITOR_TYPES.HEARTBEAT ? schemas.heartbeatCreate : schemas.create;
    validate({ body })(req, res, next);
  };

  router.post('/', requireRole(ROLES.MEMBER), validateCreate, async (req, res) => {
    const monitor = await monitors.create(req.params.wid, req.valid.body);
    res.status(201).json({ data: dto(req, monitor) });
  });

  // "Test now": one shared limiter, so both endpoints count towards the same 5/min.
  const testLimiter = createTestCheckLimiter();

  const rejectHeartbeatTest = (req, _res, next) => {
    if (req.body?.type === MONITOR_TYPES.HEARTBEAT) {
      throw new AppError(
        400,
        'NOT_SUPPORTED',
        'Heartbeat monitors are not checked by PulseBoard: your job pings them',
      );
    }
    next();
  };

  // Test an unsaved configuration (the create/edit form).
  router.post(
    '/test',
    requireRole(ROLES.MEMBER),
    rejectHeartbeatTest,
    testLimiter,
    validate({ body: schemas.create }),
    async (req, res) => {
      res.json({ data: await monitors.testConfig(req.valid.body) });
    },
  );

  // Test a saved monitor as it is configured now.
  router.post('/:mid/test', requireRole(ROLES.MEMBER), testLimiter, async (req, res) => {
    res.json({ data: await monitors.testExisting(req.params.wid, req.params.mid) });
  });

  router.get('/:mid', requireRole(ROLES.VIEWER), async (req, res) => {
    const monitor = await monitors.findInWorkspace(req.params.wid, req.params.mid);
    res.json({ data: dto(req, monitor) });
  });

  // Validated in the service: the schema depends on the stored monitor's type.
  router.patch('/:mid', requireRole(ROLES.MEMBER), async (req, res) => {
    const monitor = await monitors.update(req.params.wid, req.params.mid, req.body);
    res.json({ data: dto(req, monitor) });
  });

  router.post('/:mid/heartbeat-token', requireRole(ROLES.MEMBER), async (req, res) => {
    const monitor = await monitors.regenerateHeartbeatToken(req.params.wid, req.params.mid);
    res.json({ data: dto(req, monitor) });
  });

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
