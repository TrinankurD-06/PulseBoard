import { ROLES } from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import {
  createWorkspaceSchema,
  paginationSchema,
  updateWorkspaceSchema,
  workspaceUsageQuerySchema,
} from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { getWorkspaceUsage } from './usage.service.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspacesForUser,
  renameWorkspace,
  toWorkspaceDto,
} from './workspaces.service.js';

/** Mounted under /workspaces, after authenticate. */
export function workspacesRouter({ scheduler }) {
  const router = Router();

  router.get('/', validate({ query: paginationSchema }), async (req, res) => {
    res.json(await listWorkspacesForUser(req.userId, req.valid.query));
  });

  router.post('/', validate({ body: createWorkspaceSchema }), async (req, res) => {
    const workspace = await createWorkspace({ name: req.valid.body.name, userId: req.userId });
    res.status(201).json({ data: workspace });
  });

  router.get('/:wid', requireRole(ROLES.VIEWER), async (req, res) => {
    const workspace = await getWorkspace(req.params.wid);
    res.json({ data: toWorkspaceDto(workspace, req.membership.role) });
  });

  // Cost & Usage page (U5): every monitor's usage for a month (default: this UTC month).
  router.get(
    '/:wid/usage',
    requireRole(ROLES.VIEWER),
    validate({ query: workspaceUsageQuerySchema }),
    async (req, res) => {
      const month = req.valid.query.month ?? monthKey(new Date());
      res.json({ data: await getWorkspaceUsage(req.params.wid, month) });
    },
  );

  router.patch(
    '/:wid',
    requireRole(ROLES.OWNER),
    validate({ body: updateWorkspaceSchema }),
    async (req, res) => {
      const workspace = await renameWorkspace(req.params.wid, req.valid.body.name);
      res.json({ data: toWorkspaceDto(workspace, req.membership.role) });
    },
  );

  router.delete('/:wid', requireRole(ROLES.OWNER), async (req, res) => {
    await deleteWorkspace(req.params.wid, scheduler);
    res.status(204).end();
  });

  return router;
}
