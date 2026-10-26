import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError, notFound } from '../../lib/errors.js';
import { buildPublicStatus } from './publicStatus.service.js';

export const PUBLIC_CACHE_SECONDS = 30;

/**
 * Unauthenticated endpoints. GET /public/status/:slug is cached for 30s in two
 * places: in this process (so a busy status page costs one set of queries per
 * 30s, not one per visitor) and in browsers/CDNs via Cache-Control.
 */
export function publicRouter({ publicCache }) {
  const router = Router();

  // Generous, but stops someone hammering the aggregation with random slugs.
  router.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down.')),
    }),
  );

  router.get('/status/:slug', async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    let cached = publicCache.get(slug);
    if (!cached.hit) {
      cached = { value: await buildPublicStatus(slug) };
      publicCache.set(slug, cached.value); // "not found" is cached too
    }
    res.set('X-Cache', cached.hit ? 'HIT' : 'MISS');
    if (!cached.value) throw notFound('Status page not found');
    res.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_SECONDS}`);
    res.json({ data: cached.value });
  });

  return router;
}
