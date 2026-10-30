import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../../lib/adminAudit.js';
import { validate } from '../../middleware/validate.js';
import { createMonitorService } from '../monitors/monitors.service.js';
import { createMonitorsAdmin } from './adminMonitors.js';
import { createPlatformAdmin } from './adminPlatform.js';
import { createUsersAdmin } from './adminUsers.js';
import { createWorkspacesAdmin } from './adminWorkspaces.js';

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const text = (max = 100) => z.string().trim().max(max).optional();
const reason = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });

const userList = z.object({
  ...paging,
  search: text(),
  status: z.enum(['all', 'active', 'suspended']).default('all'),
});
const workspaceList = userList;
const monitorList = z.object({
  ...paging,
  search: text(),
  status: z.enum(['up', 'down', 'pending', 'paused', 'degraded']).optional(),
  type: z.enum(['http', 'heartbeat', 'agent']).optional(),
  workspaceId: text(40),
  ownerId: text(40),
  failing: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
const incidentList = z.object({
  ...paging,
  search: text(),
  status: z.enum(['open', 'resolved', 'all']).default('all'),
  workspaceId: text(40),
  monitorId: text(40),
});
const auditList = z.object({
  ...paging,
  adminId: text(40),
  action: text(60),
  targetType: z.enum(['user', 'workspace', 'monitor', 'incident']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
const deleteUser = z.object({
  confirm: z.string().max(200),
  mode: z.enum(['cascade', 'reassign']),
  reassignTo: text(40),
});
const transfer = z.object({ newOwnerId: z.string().max(40) });
const confirmOnly = z.object({ confirm: z.string().max(200) });
const pauseBody = z.object({ note: z.string().trim().max(300).optional() });
const bulkBody = z.object({
  action: z.enum(['pause', 'resume', 'delete']),
  ids: z.array(z.string().max(40)).min(1).max(100),
  note: z.string().trim().max(300).optional(),
  confirm: z.string().max(20).optional(),
});

/**
 * The platform admin console API, mounted under /admin AFTER authenticate, requireSuperadmin (the
 * role is re-read from the database on every request) and the admin rate limiter. req.admin is set.
 *
 * Audit: every write records its entry BEFORE it runs, so a write whose entry cannot be saved does
 * not happen (an entry therefore means "this administrator did, or tried, this"). Reading a
 * user's, workspace's, monitor's or incident's detail is recorded as well.
 */
export function adminRouter({ env, scheduler, schemas, activeUser, getRealtimeStatus }) {
  const router = Router();
  const monitorService = createMonitorService({ env, scheduler, schemas });
  const users = createUsersAdmin({ monitors: monitorService, scheduler, activeUser });
  const workspaces = createWorkspacesAdmin({ monitors: monitorService, scheduler });
  const monitors = createMonitorsAdmin({ monitors: monitorService });
  const platform = createPlatformAdmin({ getRealtimeStatus });

  const audit = (req, entry) => recordAudit(req, entry);
  const send = (res, data) => res.json({ data });

  // ---- platform ----
  router.get('/overview', async (_req, res) => send(res, await platform.overview()));
  router.get('/system', async (_req, res) => send(res, await platform.system()));
  router.get('/audit', validate({ query: auditList }), async (req, res) =>
    res.json(await platform.audit(req.valid.query)),
  );

  // ---- users ----
  router.get('/users', validate({ query: userList }), async (req, res) =>
    res.json(await users.list(req.valid.query)),
  );
  router.get('/users/:id', async (req, res) => {
    const data = await users.detail(req.params.id);
    await audit(req, { action: 'user.read', targetType: 'user', targetId: req.params.id });
    send(res, data);
  });
  router.post('/users/:id/suspend', validate({ body: reason }), async (req, res) => {
    const before = await users.snapshot(req.params.id);
    await audit(req, {
      action: 'user.suspend',
      targetType: 'user',
      targetId: req.params.id,
      before: { email: before.email, suspended: before.suspended },
      after: { suspended: true },
      note: req.valid.body.reason,
    });
    send(res, await users.suspend(req.admin, req.params.id, req.valid.body.reason));
  });
  router.post('/users/:id/unsuspend', async (req, res) => {
    const before = await users.snapshot(req.params.id);
    await audit(req, {
      action: 'user.unsuspend',
      targetType: 'user',
      targetId: req.params.id,
      before: { email: before.email, suspended: before.suspended },
      after: { suspended: false },
    });
    send(res, await users.unsuspend(req.admin, req.params.id));
  });
  router.post('/users/:id/revoke-sessions', async (req, res) => {
    const before = await users.snapshot(req.params.id);
    await audit(req, {
      action: 'user.revoke_sessions',
      targetType: 'user',
      targetId: req.params.id,
      before: { email: before.email },
    });
    send(res, await users.revokeSessions(req.admin, req.params.id));
  });
  router.delete('/users/:id', validate({ body: deleteUser }), async (req, res) => {
    const before = await users.snapshot(req.params.id);
    await audit(req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: req.params.id,
      before: { email: before.email },
      after: { deleted: true, mode: req.valid.body.mode },
    });
    send(res, await users.remove(req.admin, req.params.id, req.valid.body));
  });

  // ---- workspaces ----
  router.get('/workspaces', validate({ query: workspaceList }), async (req, res) =>
    res.json(await workspaces.list(req.valid.query)),
  );
  router.get('/workspaces/:id', async (req, res) => {
    const data = await workspaces.detail(req.params.id);
    await audit(req, {
      action: 'workspace.read',
      targetType: 'workspace',
      targetId: req.params.id,
    });
    send(res, data);
  });
  router.post('/workspaces/:id/transfer', validate({ body: transfer }), async (req, res) => {
    const before = await workspaces.snapshot(req.params.id);
    await audit(req, {
      action: 'workspace.transfer',
      targetType: 'workspace',
      targetId: req.params.id,
      before: { name: before.name, ownerId: before.ownerId },
      after: { ownerId: req.valid.body.newOwnerId },
    });
    send(res, await workspaces.transfer(req.params.id, req.valid.body.newOwnerId));
  });
  router.post('/workspaces/:id/suspend', validate({ body: reason }), async (req, res) => {
    const before = await workspaces.snapshot(req.params.id);
    await audit(req, {
      action: 'workspace.suspend',
      targetType: 'workspace',
      targetId: req.params.id,
      before: { name: before.name, suspended: before.suspended },
      after: { suspended: true },
      note: req.valid.body.reason,
    });
    send(res, await workspaces.suspend(req.params.id, req.valid.body.reason));
  });
  router.post('/workspaces/:id/unsuspend', async (req, res) => {
    const before = await workspaces.snapshot(req.params.id);
    await audit(req, {
      action: 'workspace.unsuspend',
      targetType: 'workspace',
      targetId: req.params.id,
      before: { name: before.name, suspended: before.suspended },
      after: { suspended: false },
    });
    send(res, await workspaces.unsuspend(req.params.id));
  });
  router.delete('/workspaces/:id', validate({ body: confirmOnly }), async (req, res) => {
    const before = await workspaces.snapshot(req.params.id);
    await audit(req, {
      action: 'workspace.delete',
      targetType: 'workspace',
      targetId: req.params.id,
      before: { name: before.name },
      after: { deleted: true },
    });
    send(res, await workspaces.remove(req.params.id, req.valid.body));
  });

  // ---- monitors (the global list; the bulk route is declared before /:id) ----
  router.get('/monitors', validate({ query: monitorList }), async (req, res) =>
    res.json(await monitors.list(req.valid.query)),
  );
  router.post('/monitors/bulk', validate({ body: bulkBody }), async (req, res) => {
    const { action, ids, note, confirm } = req.valid.body;
    await audit(req, {
      action: 'monitor.bulk',
      targetType: 'monitor',
      targetId: `bulk:${ids.length}`,
      after: { action, count: ids.length },
      note: [note, `ids: ${ids.slice(0, 20).join(',')}${ids.length > 20 ? ',…' : ''}`]
        .filter(Boolean)
        .join(' | '),
    });
    send(res, await monitors.bulk({ action, ids, note, confirm }));
  });
  router.get('/monitors/:id', async (req, res) => {
    const data = await monitors.detail(req.params.id);
    await audit(req, { action: 'monitor.read', targetType: 'monitor', targetId: req.params.id });
    send(res, data);
  });
  router.post('/monitors/:id/pause', validate({ body: pauseBody }), async (req, res) => {
    const before = await monitors.snapshot(req.params.id);
    await audit(req, {
      action: 'monitor.pause',
      targetType: 'monitor',
      targetId: req.params.id,
      before: { name: before.name, status: before.status, isPaused: before.isPaused },
      after: { isPaused: true, pausedBy: 'admin' },
      note: req.valid.body.note,
    });
    send(res, await monitors.pause(req.params.id, req.valid.body.note));
  });
  router.post('/monitors/:id/resume', async (req, res) => {
    const before = await monitors.snapshot(req.params.id);
    await audit(req, {
      action: 'monitor.resume',
      targetType: 'monitor',
      targetId: req.params.id,
      before: { name: before.name, status: before.status, isPaused: before.isPaused },
      after: { isPaused: false },
    });
    send(res, await monitors.resume(req.params.id));
  });
  router.post('/monitors/:id/test', async (req, res) => {
    await audit(req, { action: 'monitor.test', targetType: 'monitor', targetId: req.params.id });
    send(res, await monitors.test(req.params.id));
  });
  router.delete('/monitors/:id', validate({ body: confirmOnly }), async (req, res) => {
    const before = await monitors.snapshot(req.params.id);
    await audit(req, {
      action: 'monitor.delete',
      targetType: 'monitor',
      targetId: req.params.id,
      before: { name: before.name },
      after: { deleted: true },
    });
    send(res, await monitors.remove(req.params.id, req.valid.body));
  });

  // ---- incidents ----
  router.get('/incidents', validate({ query: incidentList }), async (req, res) =>
    res.json(await monitors.listIncidents(req.valid.query)),
  );
  router.get('/incidents/:id', async (req, res) => {
    const data = await monitors.incident(req.params.id);
    await audit(req, { action: 'incident.read', targetType: 'incident', targetId: req.params.id });
    send(res, data);
  });

  return router;
}
