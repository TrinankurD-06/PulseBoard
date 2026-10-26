import { ROLES } from '@pulseboard/shared/constants';
import {
  paginationSchema,
  statusPageSchema,
  updateStatusPageSchema,
} from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createStatusPageService } from './statusPages.service.js';

/** Mounted under /workspaces/:wid/status-pages. */
export function statusPagesRouter({ publicCache }) {
  const router = Router({ mergeParams: true });
  const pages = createStatusPageService({ publicCache });

  router.get(
    '/',
    requireRole(ROLES.VIEWER),
    validate({ query: paginationSchema }),
    async (req, res) => {
      res.json(await pages.list(req.params.wid, req.valid.query));
    },
  );

  router.post(
    '/',
    requireRole(ROLES.MEMBER),
    validate({ body: statusPageSchema }),
    async (req, res) => {
      res.status(201).json({ data: await pages.create(req.params.wid, req.valid.body) });
    },
  );

  router.get('/:pid', requireRole(ROLES.VIEWER), async (req, res) => {
    res.json({ data: await pages.findInWorkspace(req.params.wid, req.params.pid) });
  });

  router.patch(
    '/:pid',
    requireRole(ROLES.MEMBER),
    validate({ body: updateStatusPageSchema }),
    async (req, res) => {
      res.json({ data: await pages.update(req.params.wid, req.params.pid, req.valid.body) });
    },
  );

  router.delete('/:pid', requireRole(ROLES.MEMBER), async (req, res) => {
    await pages.remove(req.params.wid, req.params.pid);
    res.status(204).end();
  });

  return router;
}
