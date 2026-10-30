import { DEMO_USER_EMAIL, PLATFORM_ROLES } from '@pulseboard/shared/constants';
import { AdminAuditLog, Monitor, User } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapSuperadmins,
  ensureAdminAccount,
  grantSuperadmin,
  revokeSuperadmin,
} from '../src/modules/admin/platformAdmins.js';
import {
  addMonitor,
  buildAdminApp,
  del,
  fakeScheduler,
  get,
  post,
  signUp,
  signUpDemo,
} from './adminHelpers.js';
import { buildTestApp, testEnv } from './helpers.js';

const scheduler = fakeScheduler();
const app = buildAdminApp(scheduler);

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let admin, alice, bob, demo;
beforeEach(async () => {
  await clearMemoryDb();
  scheduler.calls.length = 0;
  admin = await signUp(app, { name: 'Boss', email: 'boss@example.com', admin: true });
  alice = await signUp(app, { name: 'Alice', email: 'alice@example.com' });
  bob = await signUp(app, { name: 'Bob', email: 'bob@example.com' });
  demo = await signUpDemo(app);
});

// Every admin route, so a new one cannot be added without being covered by the RBAC test.
const ROUTES = (ids) => [
  ['get', '/overview'],
  ['get', '/system'],
  ['get', '/audit'],
  ['get', '/users'],
  ['get', `/users/${ids.user}`],
  ['post', `/users/${ids.user}/suspend`, { reason: 'because' }],
  ['post', `/users/${ids.user}/unsuspend`],
  ['post', `/users/${ids.user}/revoke-sessions`],
  ['delete', `/users/${ids.user}`, { confirm: 'x', mode: 'cascade' }],
  ['get', '/workspaces'],
  ['get', `/workspaces/${ids.workspace}`],
  ['post', `/workspaces/${ids.workspace}/transfer`, { newOwnerId: ids.user }],
  ['post', `/workspaces/${ids.workspace}/suspend`, { reason: 'because' }],
  ['post', `/workspaces/${ids.workspace}/unsuspend`],
  ['delete', `/workspaces/${ids.workspace}`, { confirm: 'x' }],
  ['get', '/monitors'],
  ['post', '/monitors/bulk', { action: 'pause', ids: [ids.monitor] }],
  ['get', `/monitors/${ids.monitor}`],
  ['post', `/monitors/${ids.monitor}/pause`],
  ['post', `/monitors/${ids.monitor}/resume`],
  ['post', `/monitors/${ids.monitor}/test`],
  ['delete', `/monitors/${ids.monitor}`, { confirm: 'x' }],
  ['get', '/incidents'],
  ['get', `/incidents/${ids.monitor}`],
];

describe('RBAC: nobody but a superadmin gets in', () => {
  it('answers 403 to a normal user, a workspace owner and the demo account on EVERY admin route', async () => {
    const monitor = await addMonitor(app, alice, 'Shop');
    const ids = { user: bob.user.id, workspace: alice.workspaceId, monitor: monitor.id };
    // Alice owns a workspace; Bob is a plain user; demo is made a superadmin in the database, to
    // prove that even that does not let the public account in.
    await User.updateOne(
      { email: DEMO_USER_EMAIL },
      { $set: { platformRole: PLATFORM_ROLES.SUPERADMIN } },
    );
    for (const who of [alice, bob, demo]) {
      for (const [method, path, body] of ROUTES(ids)) {
        const res = await request(app)
          [method](`/api/v1/admin${path}`)
          .set(who.auth)
          .send(body ?? {});
        expect(res.status, `${who.user.email} ${method} ${path}`).toBe(403);
      }
    }
    // Nothing happened.
    expect(await AdminAuditLog.countDocuments()).toBe(0);
    expect((await Monitor.findById(monitor.id).lean()).isPaused).toBe(false);
  });

  it('answers 401 without a token', async () => {
    for (const path of ['/overview', '/users', '/audit']) {
      expect((await request(app).get(`/api/v1/admin${path}`)).status).toBe(401);
    }
  });

  it('is decided by the database on every request, not by the token', async () => {
    expect((await get(app, admin, '/users')).status).toBe(200);
    await User.updateOne(
      { email: 'boss@example.com' },
      { $set: { platformRole: PLATFORM_ROLES.USER } },
    );
    expect((await get(app, admin, '/users')).status).toBe(403); // same token, role gone
    await User.updateOne(
      { email: 'boss@example.com' },
      { $set: { platformRole: PLATFORM_ROLES.SUPERADMIN } },
    );
    expect((await get(app, admin, '/users')).status).toBe(200);
    await User.updateOne({ email: 'boss@example.com' }, { $set: { suspendedAt: new Date() } });
    expect((await get(app, admin, '/users')).status).toBe(403); // a suspended admin is not an admin
  });

  it('is reported by /auth/me only for a real superadmin (never demo)', async () => {
    const me = async (who) =>
      (await request(app).get('/api/v1/auth/me').set(who.auth)).body.data.isAdmin;
    expect(await me(admin)).toBe(true);
    expect(await me(alice)).toBe(false);
    await User.updateOne(
      { email: DEMO_USER_EMAIL },
      { $set: { platformRole: PLATFORM_ROLES.SUPERADMIN } },
    );
    expect(await me(demo)).toBe(false);
  });
});

describe('who can become a superadmin', () => {
  it('ADMIN_EMAILS grants existing accounts at start-up, and reports the rest', async () => {
    const logs = [];
    const logger = { info() {}, warn: (...args) => logs.push(args) };
    const env = {
      ...testEnv,
      ADMIN_EMAILS: ['alice@example.com', 'ghost@example.com', DEMO_USER_EMAIL],
    };
    const result = await bootstrapSuperadmins({ env, logger });
    expect(result.granted).toEqual(['alice@example.com']);
    expect(result.missing).toEqual(['ghost@example.com']);
    expect(result.skippedDemo).toEqual([DEMO_USER_EMAIL]);
    expect((await User.findOne({ email: 'alice@example.com' }).lean()).platformRole).toBe(
      'superadmin',
    );
    expect((await User.findOne({ email: DEMO_USER_EMAIL }).lean()).platformRole).toBe('user');
    expect(await User.exists({ email: 'ghost@example.com' })).toBeNull(); // never created
    expect(logs.length).toBeGreaterThan(0);
  });

  it('ADMIN_EMAIL + ADMIN_PASSWORD creates the account AND makes it a superadmin, so the evaluation login works', async () => {
    const env = {
      ...testEnv,
      ADMIN_EMAILS: [],
      ADMIN_EMAIL: 'root@example.com',
      ADMIN_PASSWORD: 'admin123',
    };
    const result = await bootstrapSuperadmins({ env });
    expect(result.account).toBe('created');
    const login = await request(buildTestApp({ env }))
      .post('/api/v1/auth/login')
      .send({ email: 'root@example.com', password: 'admin123' });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    expect((await request(app).get('/api/v1/admin/overview').set(auth)).status).toBe(200);
  });

  it('refuses the demo account however it is asked, and a short password', async () => {
    expect(await grantSuperadmin(DEMO_USER_EMAIL)).toBe('demo');
    expect(
      await ensureAdminAccount({
        env: { ...testEnv, ADMIN_EMAIL: DEMO_USER_EMAIL, ADMIN_PASSWORD: 'admin123' },
      }),
    ).toBe('demo');
    expect(
      await ensureAdminAccount({
        env: { ...testEnv, ADMIN_EMAIL: 'x@example.com', ADMIN_PASSWORD: 'short' },
      }),
    ).toBe('weak-password');
    expect(await User.exists({ email: 'x@example.com' })).toBeNull();
  });

  it('grant and revoke work on existing accounts only', async () => {
    expect(await grantSuperadmin('bob@example.com')).toBe('granted');
    expect(await grantSuperadmin('BOB@example.com')).toBe('already');
    expect(await grantSuperadmin('nobody@example.com')).toBe('missing');
    expect((await get(app, bob, '/users')).status).toBe(200);
    expect(await revokeSuperadmin('bob@example.com')).toBe('revoked');
    expect(await revokeSuperadmin('bob@example.com')).toBe('not-admin');
    expect((await get(app, bob, '/users')).status).toBe(403);
  });

  it('has no way to promote anyone through the API', async () => {
    for (const body of [{ platformRole: 'superadmin' }, { role: 'superadmin' }]) {
      await request(app)
        .patch(`/api/v1/workspaces/${alice.workspaceId}`)
        .set(alice.auth)
        .send(body);
      await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Eve', email: 'eve@example.com', password: 'password123', ...body });
    }
    expect((await User.findOne({ email: 'eve@example.com' }).lean()).platformRole).toBe('user');
    expect((await User.findOne({ email: 'alice@example.com' }).lean()).platformRole).toBe('user');
  });
});

describe('read-through: an administrator can look at any workspace, read-only', () => {
  it('reads as a viewer, never writes, and the read is audit-logged once', async () => {
    const monitor = await addMonitor(app, alice, 'Shop');
    const base = `/api/v1/workspaces/${alice.workspaceId}`;

    const list = await request(app).get(`${base}/monitors`).set(admin.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((m) => m.name)).toEqual(['Shop']);
    const one = await request(app).get(`${base}/monitors/${monitor.id}`).set(admin.auth);
    expect(one.status).toBe(200);

    const ws = await request(app).get(base).set(admin.auth);
    expect(ws.body.data).toMatchObject({ role: 'viewer', adminView: true });

    expect(
      (await request(app).post(`${base}/monitors/${monitor.id}/pause`).set(admin.auth)).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`${base}/monitors/${monitor.id}`).set(admin.auth)).status,
    ).toBe(403);
    expect((await request(app).patch(base).set(admin.auth).send({ name: 'Hacked' })).status).toBe(
      403,
    );
    expect((await Monitor.findById(monitor.id).lean()).isPaused).toBe(false);

    // Several reads, one audit entry.
    const views = await AdminAuditLog.find({ action: 'workspace.view' }).lean();
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ targetId: alice.workspaceId, adminEmail: 'boss@example.com' });
  });

  it('is only for superadmins: other users still get 404 for a workspace they are not in', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${alice.workspaceId}/monitors`)
      .set(bob.auth);
    expect(res.status).toBe(404);
  });

  it('shows no secrets to the administrator on the real read APIs (viewer masking applies)', async () => {
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/alert-channels`)
      .set(alice.auth)
      .send({
        type: 'discord',
        name: 'ops',
        target: 'https://discord.com/api/webhooks/123456/SECRETSECRETTOKEN',
      });
    const res = await request(app)
      .get(`/api/v1/workspaces/${alice.workspaceId}/alert-channels`)
      .set(admin.auth);
    expect(JSON.stringify(res.body)).not.toContain('SECRETSECRETTOKEN');
  });
});

describe('the audit log', () => {
  it('records every admin write and every detail read, with who, what, target and address', async () => {
    const monitor = await addMonitor(app, alice, 'Shop');
    const calls = [
      () => get(app, admin, `/users/${alice.user.id}`),
      () => post(app, admin, `/users/${bob.user.id}/suspend`, { reason: 'abuse report' }),
      () => post(app, admin, `/users/${bob.user.id}/unsuspend`),
      () => post(app, admin, `/users/${bob.user.id}/revoke-sessions`),
      () => get(app, admin, `/workspaces/${alice.workspaceId}`),
      () => post(app, admin, `/workspaces/${alice.workspaceId}/suspend`, { reason: 'review' }),
      () => post(app, admin, `/workspaces/${alice.workspaceId}/unsuspend`),
      () => get(app, admin, `/monitors/${monitor.id}`),
      () => post(app, admin, `/monitors/${monitor.id}/pause`, { note: 'maintenance' }),
      () => post(app, admin, `/monitors/${monitor.id}/resume`),
      () => post(app, admin, '/monitors/bulk', { action: 'pause', ids: [monitor.id] }),
      () => del(app, admin, `/monitors/${monitor.id}`, { confirm: 'Shop' }),
    ];
    for (const call of calls) expect((await call()).status).toBeLessThan(300);

    const rows = await AdminAuditLog.find().sort({ at: 1 }).lean();
    expect(rows.map((r) => r.action)).toEqual([
      'user.read',
      'user.suspend',
      'user.unsuspend',
      'user.revoke_sessions',
      'workspace.read',
      'workspace.suspend',
      'workspace.unsuspend',
      'monitor.read',
      'monitor.pause',
      'monitor.resume',
      'monitor.bulk',
      'monitor.delete',
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ adminEmail: 'boss@example.com', adminId: expect.anything() });
      expect(row.targetId).toBeTruthy();
      expect(row.at).toBeInstanceOf(Date);
      expect(row.ip).toBeTruthy();
    }
    const suspend = rows.find((r) => r.action === 'user.suspend');
    expect(suspend.summary).toMatchObject({ note: 'abuse report', after: { suspended: true } });
    expect(suspend.summary.before).toMatchObject({ email: 'bob@example.com', suspended: false });
  });

  it('does not run a write whose audit entry cannot be saved', async () => {
    const monitor = await addMonitor(app, alice, 'Shop');
    const spy = vi.spyOn(AdminAuditLog, 'create').mockRejectedValueOnce(new Error('disk full'));
    const res = await post(app, admin, `/monitors/${monitor.id}/pause`, { note: 'x' });
    expect(res.status).toBe(500);
    expect((await Monitor.findById(monitor.id).lean()).isPaused).toBe(false);
    expect(scheduler.calls.filter((c) => c[0] === 'cancel')).toHaveLength(0);
    spy.mockRestore();
  });

  it('can be read and filtered, and is paged', async () => {
    const monitor = await addMonitor(app, alice, 'Shop');
    await get(app, admin, `/users/${alice.user.id}`);
    await post(app, admin, `/monitors/${monitor.id}/pause`);
    await post(app, admin, `/monitors/${monitor.id}/resume`);
    const all = await get(app, admin, '/audit');
    expect(all.body.pagination.total).toBe(3);
    expect(all.body.data[0].action).toBe('monitor.resume'); // newest first
    const pauses = await get(app, admin, '/audit?action=monitor.pause');
    expect(pauses.body.data.map((r) => r.action)).toEqual(['monitor.pause']);
    const users = await get(app, admin, '/audit?targetType=user');
    expect(users.body.data).toHaveLength(1);
    const mine = await get(app, admin, `/audit?adminId=${admin.user.id}&limit=2&page=2`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.pagination).toMatchObject({ total: 3, page: 2, limit: 2 });
    const future = await get(
      app,
      admin,
      `/audit?from=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`,
    );
    expect(future.body.data).toHaveLength(0);
    expect((await get(app, admin, '/audit?targetType=nope')).status).toBe(400);
  });
});

describe('rate limits', () => {
  it('limits admin writes per administrator (60 a minute) without touching reads', async () => {
    const monitor = await addMonitor(app, alice, 'Shop');
    let limited = 0;
    for (let i = 0; i < 65; i += 1) {
      const res = await post(app, admin, `/monitors/${monitor.id}/resume`);
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThanOrEqual(5);
    expect((await get(app, admin, '/overview')).status).toBe(200); // reads have their own budget
  });
});
