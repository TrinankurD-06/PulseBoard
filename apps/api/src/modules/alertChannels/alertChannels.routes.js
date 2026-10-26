import { ROLES } from '@pulseboard/shared/constants';
import {
  alertChannelSchema,
  paginationSchema,
  updateAlertChannelSchema,
} from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { createTestAlertLimiter } from '../../middleware/rateLimits.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createAlertChannelService, toChannelDto } from './alertChannels.service.js';

/** Mounted under /workspaces/:wid/alert-channels. */
export function alertChannelsRouter({ senders, env }) {
  const router = Router({ mergeParams: true });
  const channels = createAlertChannelService({ senders, env });
  const dto = (req, channel) => toChannelDto(channel, req.membership.role);

  router.get(
    '/',
    requireRole(ROLES.VIEWER),
    validate({ query: paginationSchema }),
    async (req, res) => {
      const result = await channels.list(req.params.wid, req.valid.query);
      res.json({ ...result, data: result.data.map((channel) => dto(req, channel)) });
    },
  );

  router.post(
    '/',
    requireRole(ROLES.MEMBER),
    validate({ body: alertChannelSchema }),
    async (req, res) => {
      const channel = await channels.create(req.params.wid, req.valid.body);
      res.status(201).json({ data: dto(req, channel) });
    },
  );

  router.get('/:cid', requireRole(ROLES.VIEWER), async (req, res) => {
    res.json({ data: dto(req, await channels.findInWorkspace(req.params.wid, req.params.cid)) });
  });

  router.patch(
    '/:cid',
    requireRole(ROLES.MEMBER),
    validate({ body: updateAlertChannelSchema }),
    async (req, res) => {
      const channel = await channels.update(req.params.wid, req.params.cid, req.valid.body);
      res.json({ data: dto(req, channel) });
    },
  );

  router.delete('/:cid', requireRole(ROLES.MEMBER), async (req, res) => {
    await channels.remove(req.params.wid, req.params.cid);
    res.status(204).end();
  });

  router.post(
    '/:cid/test',
    requireRole(ROLES.MEMBER),
    createTestAlertLimiter(),
    async (req, res) => {
      res.json({ data: await channels.sendTest(req.params.wid, req.params.cid) });
    },
  );

  return router;
}
