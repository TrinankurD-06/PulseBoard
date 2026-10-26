import { ROLES } from '@pulseboard/shared/constants';
import { Incident } from '@pulseboard/shared/models';
import { objectIdSchema, paginationSchema } from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';

const listQuery = paginationSchema.extend({
  status: z.enum(['open', 'resolved']).optional(),
  monitorId: objectIdSchema.optional(),
});

const withMonitor = (query) => query.populate('monitorId', 'name url');

/** Incidents carry their monitor's name/url so lists don't need a second request. */
function toIncidentDto(incident) {
  const { monitorId: monitor, deliveredAlerts: _internal, ...rest } = incident.toJSON();
  return {
    ...rest,
    monitorId: monitor?.id ?? String(incident.monitorId),
    monitor: monitor ? { id: monitor.id, name: monitor.name, url: monitor.url } : null,
  };
}

/** Mounted under /workspaces/:wid/incidents. Read-only: incidents are created by the worker. */
export function incidentsRouter() {
  const router = Router({ mergeParams: true });

  router.get('/', requireRole(ROLES.VIEWER), validate({ query: listQuery }), async (req, res) => {
    const { status, monitorId, page, limit } = req.valid.query;
    const filter = {
      workspaceId: req.params.wid,
      ...(status === 'open' && { resolvedAt: null }),
      ...(status === 'resolved' && { resolvedAt: { $ne: null } }),
      ...(monitorId && { monitorId }),
    };
    const result = await paginate(Incident, filter, { page, limit }, (query) =>
      withMonitor(query.sort({ startedAt: -1 })),
    );
    res.json({ ...result, data: result.data.map(toIncidentDto) });
  });

  router.get('/:iid', requireRole(ROLES.VIEWER), async (req, res) => {
    const { success } = objectIdSchema.safeParse(req.params.iid);
    const incident =
      success &&
      (await withMonitor(Incident.findOne({ _id: req.params.iid, workspaceId: req.params.wid })));
    if (!incident) throw notFound('Incident not found');
    res.json({ data: toIncidentDto(incident) });
  });

  return router;
}
