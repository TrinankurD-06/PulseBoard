import { ROLES } from '@pulseboard/shared/constants';
import { githubCandidatesQuerySchema, githubImportSchema } from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createGithubService } from './github.service.js';

/**
 * Mounted under /workspaces/:wid/github. Members and above only: importing
 * creates monitors, and listing uses the caller's own GitHub token.
 */
export function githubRouter({ env, scheduler, schemas, publicCache, githubFetch, githubProbe }) {
  const router = Router({ mergeParams: true });
  const github = createGithubService({
    env,
    scheduler,
    schemas,
    publicCache,
    fetchImpl: githubFetch,
    probe: githubProbe,
  });

  router.get(
    '/candidates',
    requireRole(ROLES.MEMBER),
    validate({ query: githubCandidatesQuerySchema }),
    async (req, res) => {
      const data = await github.candidates(req.params.wid, req.userId, req.valid.query);
      res.json({ data });
    },
  );

  router.post(
    '/import',
    requireRole(ROLES.MEMBER),
    validate({ body: githubImportSchema }),
    async (req, res) => {
      const data = await github.importUrls(req.params.wid, req.userId, req.valid.body);
      res.status(201).json({ data });
    },
  );

  return router;
}
