import { z } from 'zod';
import { objectIdSchema } from './common.js';

/** Most URLs one import request may carry. */
export const GITHUB_IMPORT_MAX_URLS = 50;

export const githubCandidatesQuerySchema = z.object({
  forks: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

// URLs are only checked for being strings here: each one is re-validated with
// the monitor create schema at import time, so one bad URL is "skipped", not a 400.
export const githubImportSchema = z.object({
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1, 'Select at least one URL')
    .max(GITHUB_IMPORT_MAX_URLS, `At most ${GITHUB_IMPORT_MAX_URLS} URLs per import`),
  statusPage: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('create'), title: z.string().trim().min(1).max(100).optional() }),
      z.object({ mode: z.literal('extend'), id: objectIdSchema }),
    ])
    .optional(),
});
