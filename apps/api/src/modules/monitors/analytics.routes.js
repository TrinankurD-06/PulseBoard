import { CHECK_RESULT_TTL_SEC, ROLES } from '@pulseboard/shared/constants';
import { Monitor } from '@pulseboard/shared/models';
import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import {
  getAgentMetrics,
  getChecksInRange,
  getDailySeries,
  getRecentChecks,
  getSparklines,
  getUptime,
  getUptimeSummary,
  getUsage,
} from './analytics.service.js';
import { getMetrics, METRIC_RANGES } from './metrics.service.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
const HOUR_MS = 60 * 60 * 1000;

const checksQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Alternative to a range: the latest N checks (timing breakdown chart).
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const dailyQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(90) });
const metricsQuery = z.object({ range: z.enum(Object.keys(METRIC_RANGES)).default('24h') });
const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const sparklineQuery = z.object({ points: z.coerce.number().int().min(2).max(60).default(30) });

/** 404 unless the monitor belongs to this workspace (same rule as the CRUD routes). */
async function assertMonitorInWorkspace(req, _res, next) {
  const { wid, mid } = req.params;
  if (!OBJECT_ID.test(mid) || !(await Monitor.exists({ _id: mid, workspaceId: wid }))) {
    throw notFound('Monitor not found');
  }
  next();
}

/**
 * Read-only analytics under /workspaces/:wid/monitors. Mounted BEFORE the CRUD
 * router so "/sparklines" isn't mistaken for a monitor id.
 */
export function monitorAnalyticsRouter() {
  const router = Router({ mergeParams: true });
  const viewer = requireRole(ROLES.VIEWER);

  router.get('/sparklines', viewer, validate({ query: sparklineQuery }), async (req, res) => {
    res.json({ data: await getSparklines(req.params.wid, req.valid.query.points) });
  });

  // Workspace-wide uptime over the last N days (dashboard gauge), from rollups.
  router.get('/uptime-summary', viewer, validate({ query: summaryQuery }), async (req, res) => {
    res.json({ data: await getUptimeSummary(req.params.wid, req.valid.query.days) });
  });

  router.get('/:mid/usage', viewer, assertMonitorInWorkspace, async (req, res) => {
    res.json({ data: await getUsage(req.params.mid) });
  });

  router.get('/:mid/uptime', viewer, assertMonitorInWorkspace, async (req, res) => {
    res.json({ data: await getUptime(req.params.mid) });
  });

  router.get(
    '/:mid/checks',
    viewer,
    assertMonitorInWorkspace,
    validate({ query: checksQuery }),
    async (req, res) => {
      const { from, to, limit } = req.valid.query;
      if (limit) {
        res.json({ data: await getRecentChecks(req.params.mid, limit) });
        return;
      }
      const end = to ?? new Date();
      const start = from ?? new Date(end - 24 * HOUR_MS);
      if (start >= end) throw badRequest('"from" must be before "to"');
      // Raw checks only exist for 7 days; longer ranges belong to /daily.
      if (end - start > CHECK_RESULT_TTL_SEC * 1000) {
        throw badRequest('Range can be at most 7 days. Use /daily for longer periods.');
      }
      res.json({ data: await getChecksInRange(req.params.mid, start, end) });
    },
  );

  // Agent monitors (U4): request rate, error rate, latency percentiles, top routes.
  router.get(
    '/:mid/agent-metrics',
    viewer,
    assertMonitorInWorkspace,
    validate({ query: rangeQuery }),
    async (req, res) => {
      const { from, to } = req.valid.query;
      const end = to ?? new Date();
      const start = from ?? new Date(end - HOUR_MS);
      if (start >= end) throw badRequest('"from" must be before "to"');
      if (end - start > 24 * HOUR_MS) throw badRequest('Range can be at most 24 hours');
      res.json({ data: await getAgentMetrics(req.params.mid, start, end) });
    },
  );

  // Health deck: bucketed metrics per monitor type with change vs the previous window.
  router.get(
    '/:mid/metrics',
    viewer,
    assertMonitorInWorkspace,
    validate({ query: metricsQuery }),
    async (req, res) => {
      res.json({ data: await getMetrics(req.params.mid, req.valid.query.range) });
    },
  );

  router.get(
    '/:mid/daily',
    viewer,
    assertMonitorInWorkspace,
    validate({ query: dailyQuery }),
    async (req, res) => {
      res.json({ data: await getDailySeries(req.params.mid, req.valid.query.days) });
    },
  );

  return router;
}
