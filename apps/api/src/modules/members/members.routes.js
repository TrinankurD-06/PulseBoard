import { ROLES } from '@pulseboard/shared/constants';
import {
  addMemberSchema,
  objectIdSchema,
  paginationSchema,
  updateMemberSchema,
} from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { addMember, changeMemberRole, listMembers, removeMember } from './members.service.js';

const memberParams = z.object({ wid: objectIdSchema, uid: objectIdSchema });

/** Mounted under /workspaces/:wid/members (mergeParams exposes :wid). */
export function membersRouter() {
  const router = Router({ mergeParams: true });

  router.get(
    '/',
    requireRole(ROLES.VIEWER),
    validate({ query: paginationSchema }),
    async (req, res) => {
      res.json(await listMembers(req.params.wid, req.valid.query));
    },
  );

  router.post(
    '/',
    requireRole(ROLES.OWNER),
    validate({ body: addMemberSchema }),
    async (req, res) => {
      res.status(201).json({ data: await addMember(req.params.wid, req.valid.body) });
    },
  );

  router.patch(
    '/:uid',
    requireRole(ROLES.OWNER),
    validate({ params: memberParams, body: updateMemberSchema }),
    async (req, res) => {
      const { wid, uid } = req.valid.params;
      res.json({ data: await changeMemberRole(wid, uid, req.valid.body.role) });
    },
  );

  router.delete(
    '/:uid',
    requireRole(ROLES.OWNER),
    validate({ params: memberParams }),
    async (req, res) => {
      await removeMember(req.valid.params.wid, req.valid.params.uid);
      res.status(204).end();
    },
  );

  return router;
}
