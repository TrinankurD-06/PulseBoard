import {
  AlertChannel,
  AlertLog,
  ErrorLog,
  Incident,
  Membership,
  Monitor,
  Session,
  User,
  Workspace,
} from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { routePattern } from '../src/lib/errorLog.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  addMonitor,
  buildAdminApp,
  del,
  fakeScheduler,
  get,
  kinds,
  post,
  signUp,
  signUpDemo,
} from './adminHelpers.js';
import { refreshCookie } from './helpers.js';

const scheduler = fakeScheduler();
const app = buildAdminApp(scheduler);

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let admin, alice, bob, carol;
beforeEach(async () => {
  await clearMemoryDb();
  scheduler.calls.length = 0;
  admin = await signUp(app, { name: 'Boss', email: 'boss@example.com', admin: true });
  alice = await signUp(app, { name: 'Alice', email: 'alice@example.com' });
  bob = await signUp(app, { name: 'Bob', email: 'bob@example.com' });
  carol = await signUp(app, { name: 'Carol', email: 'carol@example.com' });
});

const rowFor = async (email) =>
  (await get(app, admin, '/users?limit=100')).body.data.find((row) => row.email === email);

describe('users', () => {
  it('lists every user with provider, dates, role, workspaces and monitors, paged and filtered', async () => {
    await addMonitor(app, alice, 'Shop');
    await addMonitor(app, alice, 'Blog');
    await User.updateOne(
      { email: 'bob@example.com' },
      { $push: { identities: { provider: 'github', providerId: '9' } } },
    );
    const res = await get(app, admin, '/users?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ total: 4, page: 1, limit: 100 });
    const a = res.body.data.find((u) => u.email === 'alice@example.com');
    expect(a).toMatchObject({
      name: 'Alice',
      providers: [],
      platformRole: 'user',
      suspendedAt: null,
      isDemo: false,
      workspacesCount: 1,
      monitorsCount: 2,
    });
    expect(a.lastLoginAt).toBeTruthy();
    expect(res.body.data.find((u) => u.email === 'bob@example.com').providers).toEqual(['github']);
    expect(res.body.data.find((u) => u.email === 'boss@example.com').platformRole).toBe(
      'superadmin',
    );

    expect((await get(app, admin, '/users?search=ali')).body.data.map((u) => u.name)).toEqual([
      'Alice',
    ]);
    expect((await get(app, admin, '/users?search=.*')).body.data).toHaveLength(0); // text, not a regex
    const page2 = await get(app, admin, '/users?limit=3&page=2');
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect((await get(app, admin, '/users?limit=999')).status).toBe(400);
  });

  it('includes the demo account, managed through its demo workspace although it is only a viewer', async () => {
    const demo = await signUpDemo(app);
    await addMonitor(app, demo, 'Demo API');
    await Membership.updateOne({ userId: demo.user.id }, { $set: { role: 'viewer' } });
    const row = await rowFor('demo@pulseboard.dev');
    expect(row).toMatchObject({ isDemo: true, monitorsCount: 1 });
    const detail = (await get(app, admin, `/users/${demo.user.id}`)).body.data;
    expect(detail.profile.isDemo).toBe(true);
    expect(detail.monitors.map((m) => m.name)).toEqual(['Demo API']);
  });

  it('filters by status', async () => {
    await post(app, admin, `/users/${bob.user.id}/suspend`, { reason: 'abuse' });
    expect((await get(app, admin, '/users?status=suspended')).body.data.map((u) => u.name)).toEqual(
      ['Bob'],
    );
    expect((await get(app, admin, '/users?status=active')).body.data).toHaveLength(3);
  });

  it('shows a user detail page: profile, workspaces, monitors, incidents, channels, usage, analytics', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/alert-channels`)
      .set(alice.auth)
      .send({
        type: 'discord',
        name: 'ops',
        target: 'https://discord.com/api/webhooks/1/abcdef-WXYZ',
      });
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/alert-channels`)
      .set(alice.auth)
      .send({ type: 'email', name: 'me', target: 'alice@example.com' });
    await Incident.create({
      monitorId: shop.id,
      workspaceId: alice.workspaceId,
      startedAt: new Date(Date.now() - 3600e3),
      cause: 'HTTP 503',
      causeCode: 'HTTP_503',
    });
    await AlertLog.create({ channelType: 'email', ok: true, workspaceId: alice.workspaceId });

    const res = await get(app, admin, `/users/${alice.user.id}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.profile).toMatchObject({
      email: 'alice@example.com',
      sessionsActive: 1,
      isDemo: false,
    });
    expect(d.workspaces).toEqual([
      expect.objectContaining({ id: alice.workspaceId, role: 'owner', monitorsCount: 1 }),
    ]);
    expect(d.monitors.map((m) => m.name)).toEqual(['Shop']);
    expect(d.incidents[0]).toMatchObject({ monitorName: 'Shop', cause: 'HTTP 503' });
    const channels = Object.fromEntries(d.alertChannels.map((c) => [c.type, c]));
    expect(channels.discord.targetMasked).toBe('…WXYZ'); // the last 4 characters only
    expect(channels.email.targetMasked).toBe('alice@example.com'); // emails are visible to admins
    expect(d.usage).toMatchObject({ requests: expect.any(Number), monthlyCost: expect.any(Array) });
    expect(d.analytics).toMatchObject({ checks30d: expect.any(Number), alertsSent30d: 1 });
    expect((await get(app, admin, `/users/${'0'.repeat(24)}`)).status).toBe(404);
    expect((await get(app, admin, '/users/nope')).status).toBe(404);
  });
});

describe('suspend, revoke sessions, delete', () => {
  it('suspending blocks login and every existing token, ends sessions and pauses their monitors', async () => {
    const shop = await addMonitor(app, bob, 'Shop');
    await addMonitor(app, bob, 'Blog');
    scheduler.calls.length = 0;
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    const cookie = refreshCookie(login);

    const res = await post(app, admin, `/users/${bob.user.id}/suspend`, { reason: 'abuse report' });
    expect(res.body.data).toMatchObject({ ok: true, pausedMonitors: 2 });

    // Cannot sign in, with the right password.
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    // The access token he already holds stops working at once, on any route.
    for (const path of ['/api/v1/auth/me', `/api/v1/workspaces/${bob.workspaceId}/monitors`]) {
      const r = await request(app).get(path).set(bob.auth);
      expect(r.status, path).toBe(403);
      expect(r.body.error.code).toBe('ACCOUNT_SUSPENDED');
    }
    // And his refresh token cannot be used to get a new one.
    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect([401, 403]).toContain(refreshed.status);
    expect(await Session.countDocuments({ userId: bob.user.id, revokedAt: null })).toBe(0);

    // Monitors paused through the same scheduling path, with the reason the owner will read.
    expect(kinds(scheduler)).toEqual(['cancel', 'cancel']);
    expect(await Monitor.findById(shop.id).lean()).toMatchObject({
      isPaused: true,
      pausedReason: 'admin',
      pauseNote: 'Account suspended: abuse report',
    });
  });

  it('unsuspending lets them back in but does not restart monitors by itself', async () => {
    const shop = await addMonitor(app, bob, 'Shop');
    await post(app, admin, `/users/${bob.user.id}/suspend`, { reason: 'abuse' });
    expect((await post(app, admin, `/users/${bob.user.id}/unsuspend`)).body.data.ok).toBe(true);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect((await Monitor.findById(shop.id).lean()).isPaused).toBe(true);
  });

  it('protects administrators: not yourself, not another superadmin', async () => {
    const other = await signUp(app, { name: 'Other', email: 'other@example.com', admin: true });
    for (const target of [admin, other]) {
      const res = await post(app, admin, `/users/${target.user.id}/suspend`, { reason: 'nope' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ADMIN_PROTECTED');
    }
    expect(
      (
        await del(app, admin, `/users/${other.user.id}`, {
          confirm: 'other@example.com',
          mode: 'cascade',
        })
      ).status,
    ).toBe(409);
    expect(await User.exists({ email: 'other@example.com' })).toBeTruthy();
  });

  it('needs a reason to suspend', async () => {
    expect((await post(app, admin, `/users/${bob.user.id}/suspend`, {})).status).toBe(400);
    expect((await post(app, admin, `/users/${bob.user.id}/suspend`, { reason: 'x' })).status).toBe(
      400,
    );
  });

  it('revoking sessions ends their refresh tokens', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });
    const cookie = refreshCookie(login);
    const res = await post(app, admin, `/users/${bob.user.id}/revoke-sessions`);
    expect(res.body.data.revoked).toBeGreaterThanOrEqual(2);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(
      401,
    );
    // They can sign in again: this is not a suspension.
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'bob@example.com', password: 'password123' })
      ).status,
    ).toBe(200);
  });

  it('delete needs the email typed exactly, then removes the account and its sole-owner workspaces', async () => {
    const shop = await addMonitor(app, bob, 'Shop');
    const path = `/users/${bob.user.id}`;
    const wrong = await del(app, admin, path, { confirm: 'bob', mode: 'cascade' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(await User.exists({ email: 'bob@example.com' })).toBeTruthy();

    scheduler.calls.length = 0;
    const res = await del(app, admin, path, { confirm: 'bob@example.com', mode: 'cascade' });
    expect(res.body.data).toMatchObject({
      ok: true,
      deletedWorkspaces: 1,
      reassignedWorkspaces: 0,
    });
    expect(await User.exists({ email: 'bob@example.com' })).toBeNull();
    expect(await Workspace.exists({ _id: bob.workspaceId })).toBeNull();
    expect(await Monitor.exists({ _id: shop.id })).toBeNull();
    expect(await Session.countDocuments({ userId: bob.user.id })).toBe(0);
    expect(kinds(scheduler)).toContain('cancel');
  });

  it("never deletes other people's data with a user: a shared workspace is handed to a member", async () => {
    await request(app)
      .post(`/api/v1/workspaces/${bob.workspaceId}/members`)
      .set(bob.auth)
      .send({ email: 'carol@example.com', role: 'member' });
    const shop = await addMonitor(app, bob, 'Shop');
    const res = await del(app, admin, `/users/${bob.user.id}`, {
      confirm: 'bob@example.com',
      mode: 'cascade',
    });
    expect(res.body.data).toMatchObject({ deletedWorkspaces: 0, reassignedWorkspaces: 1 });
    expect(await Monitor.exists({ _id: shop.id })).toBeTruthy();
    const membership = await Membership.findOne({
      workspaceId: bob.workspaceId,
      userId: carol.user.id,
    }).lean();
    expect(membership.role).toBe('owner');
    expect(String((await Workspace.findById(bob.workspaceId).lean()).ownerId)).toBe(carol.user.id);
  });

  it('reassign mode hands the workspaces to the chosen user', async () => {
    await addMonitor(app, bob, 'Shop');
    expect(
      (
        await del(app, admin, `/users/${bob.user.id}`, {
          confirm: 'bob@example.com',
          mode: 'reassign',
        })
      ).status,
    ).toBe(400);
    const res = await del(app, admin, `/users/${bob.user.id}`, {
      confirm: 'bob@example.com',
      mode: 'reassign',
      reassignTo: alice.user.id,
    });
    expect(res.body.data).toMatchObject({ deletedWorkspaces: 0, reassignedWorkspaces: 1 });
    expect(String((await Workspace.findById(bob.workspaceId).lean()).ownerId)).toBe(alice.user.id);
    expect(
      (await Membership.findOne({ workspaceId: bob.workspaceId, userId: alice.user.id }).lean())
        .role,
    ).toBe('owner');
  });
});

describe('workspaces', () => {
  it('lists and shows a workspace with members, monitors, status pages, incidents and usage', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: 'bob@example.com', role: 'viewer' });
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/status-pages`)
      .set(alice.auth)
      .send({ title: 'Status', slug: 'alice-status', monitorIds: [shop.id] });
    const list = await get(app, admin, '/workspaces?search=alice');
    expect(list.body.data[0]).toMatchObject({
      owner: { email: 'alice@example.com' },
      membersCount: 2,
      monitorsCount: 1,
      openIncidents: 0,
      suspendedAt: null,
    });
    const detail = (await get(app, admin, `/workspaces/${alice.workspaceId}`)).body.data;
    expect(detail.members.map((m) => [m.email, m.role]).sort()).toEqual([
      ['alice@example.com', 'owner'],
      ['bob@example.com', 'viewer'],
    ]);
    expect(detail.monitors).toHaveLength(1);
    expect(detail.statusPages[0]).toMatchObject({ slug: 'alice-status', monitorsCount: 1 });
    expect(detail.usage).toMatchObject({ requests: expect.any(Number) });
    expect((await get(app, admin, '/workspaces?status=suspended')).body.data).toHaveLength(0);
    expect((await get(app, admin, `/workspaces/${'1'.repeat(24)}`)).status).toBe(404);
  });

  it('transfers ownership to an existing member, the old owner staying on as a member', async () => {
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: 'bob@example.com', role: 'member' });
    const stranger = await post(app, admin, `/workspaces/${alice.workspaceId}/transfer`, {
      newOwnerId: carol.user.id,
    });
    expect(stranger.status).toBe(400);
    const res = await post(app, admin, `/workspaces/${alice.workspaceId}/transfer`, {
      newOwnerId: bob.user.id,
    });
    expect(res.body.data.ok).toBe(true);
    const roles = Object.fromEntries(
      (await Membership.find({ workspaceId: alice.workspaceId }).lean()).map((m) => [
        String(m.userId),
        m.role,
      ]),
    );
    expect(roles).toEqual({ [bob.user.id]: 'owner', [alice.user.id]: 'member' });
    expect(String((await Workspace.findById(alice.workspaceId).lean()).ownerId)).toBe(bob.user.id);
  });

  it('suspending shuts its members out with a reason and pauses its monitors; the reason stays readable', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    scheduler.calls.length = 0;
    const res = await post(app, admin, `/workspaces/${alice.workspaceId}/suspend`, {
      reason: 'payment dispute',
    });
    expect(res.body.data).toMatchObject({ ok: true, pausedMonitors: 1 });
    expect(kinds(scheduler)).toEqual(['cancel']);

    const blocked = await request(app)
      .get(`/api/v1/workspaces/${alice.workspaceId}/monitors`)
      .set(alice.auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('WORKSPACE_SUSPENDED');
    expect(blocked.body.error.details.reason).toBe('payment dispute');
    // The workspace itself is still readable, so the app can say why.
    const info = await request(app).get(`/api/v1/workspaces/${alice.workspaceId}`).set(alice.auth);
    expect(info.status).toBe(200);
    expect(info.body.data.suspendedAt).toBeTruthy();
    expect((await Monitor.findById(shop.id).lean()).pauseNote).toBe(
      'Workspace suspended: payment dispute',
    );
    // Administrators can still look.
    expect(
      (await request(app).get(`/api/v1/workspaces/${alice.workspaceId}/monitors`).set(admin.auth))
        .status,
    ).toBe(200);

    await post(app, admin, `/workspaces/${alice.workspaceId}/unsuspend`);
    expect(
      (await request(app).get(`/api/v1/workspaces/${alice.workspaceId}/monitors`).set(alice.auth))
        .status,
    ).toBe(200);
  });

  it('deletes only with the name typed exactly', async () => {
    await addMonitor(app, alice, 'Shop');
    const name = (await Workspace.findById(alice.workspaceId).lean()).name;
    const wrong = await del(app, admin, `/workspaces/${alice.workspaceId}`, { confirm: 'delete' });
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(await Workspace.exists({ _id: alice.workspaceId })).toBeTruthy();
    expect(
      (await del(app, admin, `/workspaces/${alice.workspaceId}`, { confirm: name })).status,
    ).toBe(200);
    expect(await Workspace.exists({ _id: alice.workspaceId })).toBeNull();
    expect(await Monitor.countDocuments({ workspaceId: alice.workspaceId })).toBe(0);
  });
});

describe('monitors across all users', () => {
  async function seed() {
    const shop = await addMonitor(app, alice, 'Shop');
    const blog = await addMonitor(app, alice, 'Blog');
    const api = await addMonitor(app, bob, 'Bobs API');
    const cron = await request(app)
      .post(`/api/v1/workspaces/${bob.workspaceId}/monitors`)
      .set(bob.auth)
      .send({ name: 'Nightly job', type: 'heartbeat', expectedEverySec: 3600 });
    await Monitor.updateOne({ _id: blog.id }, { $set: { status: 'down', lastOk: false } });
    await Monitor.updateOne({ _id: api.id }, { $set: { status: 'up', lastOk: true } });
    return { shop, blog, api, cron: cron.body.data };
  }

  it('lists everything with workspace and owner, and filters by status, type, workspace, owner, failing and text', async () => {
    const m = await seed();
    const all = await get(app, admin, '/monitors');
    expect(all.body.pagination.total).toBe(4);
    const row = all.body.data.find((r) => r.name === 'Shop');
    expect(row).toMatchObject({
      type: 'http',
      pausedBy: null,
      workspace: { id: alice.workspaceId },
      owner: { email: 'alice@example.com' },
    });
    const names = async (q) =>
      (await get(app, admin, `/monitors?${q}`)).body.data.map((r) => r.name).sort();
    expect(await names('status=down')).toEqual(['Blog']);
    expect(await names('type=heartbeat')).toEqual(['Nightly job']);
    expect(await names(`workspaceId=${bob.workspaceId}`)).toEqual(['Bobs API', 'Nightly job']);
    expect(await names(`ownerId=${alice.user.id}`)).toEqual(['Blog', 'Shop']);
    expect(await names('failing=true')).toEqual(['Blog']);
    expect(await names('search=nightly')).toEqual(['Nightly job']);
    expect(await names(`status=down&ownerId=${bob.user.id}`)).toEqual([]);
    const page = await get(app, admin, '/monitors?limit=3&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect((await get(app, admin, `/monitors/${m.shop.id}`)).body.data).toMatchObject({
      name: 'Shop',
      workspaceId: alice.workspaceId,
    });
  });

  it('pause cancels the Agenda job and the owner sees why; the owner cannot undo it; resume re-creates the job', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    scheduler.calls.length = 0;

    const paused = await post(app, admin, `/monitors/${shop.id}/pause`, {
      note: 'Investigating abuse',
    });
    expect(paused.body.data).toEqual({ ok: true, changed: true });
    expect(scheduler.calls).toEqual([['cancel', shop.id]]);

    const seen = await request(app)
      .get(`/api/v1/workspaces/${alice.workspaceId}/monitors/${shop.id}`)
      .set(alice.auth);
    expect(seen.body.data).toMatchObject({
      isPaused: true,
      pausedBy: 'admin',
      pauseNote: 'Investigating abuse',
      status: 'paused',
    });
    const mine = `/api/v1/workspaces/${alice.workspaceId}/monitors/${shop.id}`;
    const tryResume = await request(app).post(`${mine}/resume`).set(alice.auth);
    expect(tryResume.status).toBe(403);
    expect(tryResume.body.error.code).toBe('STOPPED_BY_ADMIN');
    await request(app).post(`${mine}/pause`).set(alice.auth); // cannot relabel it as their own
    expect((await request(app).post(`${mine}/resume`).set(alice.auth)).status).toBe(403);

    scheduler.calls.length = 0;
    const resumed = await post(app, admin, `/monitors/${shop.id}/resume`);
    expect(resumed.body.data).toEqual({ ok: true, changed: true });
    expect(scheduler.calls).toEqual([['schedule', shop.id, 60].slice(0, 2)]);
    const after = await request(app).get(mine).set(alice.auth);
    expect(after.body.data).toMatchObject({ isPaused: false, pausedBy: null });
    expect(after.body.data.pauseNote).toBeUndefined();
  });

  it('pausing twice or resuming a running monitor changes nothing', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    expect((await post(app, admin, `/monitors/${shop.id}/resume`)).body.data.changed).toBe(false);
    await post(app, admin, `/monitors/${shop.id}/pause`);
    expect((await post(app, admin, `/monitors/${shop.id}/pause`)).body.data.changed).toBe(false);
  });

  it('deletes only with the name typed exactly', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    expect(
      (await del(app, admin, `/monitors/${shop.id}`, { confirm: 'shop' })).body.error.code,
    ).toBe('CONFIRMATION_MISMATCH');
    expect(await Monitor.exists({ _id: shop.id })).toBeTruthy();
    expect((await del(app, admin, `/monitors/${shop.id}`, { confirm: 'Shop' })).status).toBe(200);
    expect(await Monitor.exists({ _id: shop.id })).toBeNull();
    expect(scheduler.calls.at(-1)[0]).toBe('cancel');
  });

  it('bulk pause, resume and delete work on many, reporting what could not be done', async () => {
    const a = await addMonitor(app, alice, 'A');
    const b = await addMonitor(app, bob, 'B');
    const ids = [a.id, b.id, '0'.repeat(24)];
    const paused = await post(app, admin, '/monitors/bulk', {
      action: 'pause',
      ids,
      note: 'maintenance',
    });
    expect(paused.body.data).toMatchObject({ changed: 2, skipped: 0 });
    expect(paused.body.data.failed).toEqual([expect.objectContaining({ id: '0'.repeat(24) })]);
    expect(
      (await Monitor.find({ _id: { $in: [a.id, b.id] } }).lean()).every(
        (m) => m.pausedReason === 'admin',
      ),
    ).toBe(true);
    expect(
      (await post(app, admin, '/monitors/bulk', { action: 'pause', ids: [a.id] })).body.data,
    ).toMatchObject({ changed: 0, skipped: 1 });
    expect(
      (await post(app, admin, '/monitors/bulk', { action: 'resume', ids: [a.id, b.id] })).body.data
        .changed,
    ).toBe(2);

    const noConfirm = await post(app, admin, '/monitors/bulk', { action: 'delete', ids: [a.id] });
    expect(noConfirm.body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(await Monitor.exists({ _id: a.id })).toBeTruthy();
    expect(
      (
        await post(app, admin, '/monitors/bulk', {
          action: 'delete',
          ids: [a.id, b.id],
          confirm: 'DELETE',
        })
      ).body.data.changed,
    ).toBe(2);
    expect(await Monitor.countDocuments()).toBe(0);
    expect((await post(app, admin, '/monitors/bulk', { action: 'pause', ids: [] })).status).toBe(
      400,
    );
    expect(
      (await post(app, admin, '/monitors/bulk', { action: 'pause', ids: Array(101).fill(a.id) }))
        .status,
    ).toBe(400);
  });

  it('never shows a heartbeat token, headers, agent keys or query strings', async () => {
    const cron = await request(app)
      .post(`/api/v1/workspaces/${bob.workspaceId}/monitors`)
      .set(bob.auth)
      .send({ name: 'Nightly', type: 'heartbeat', expectedEverySec: 3600 });
    const secretUrl = await addMonitor(app, bob, 'Tokened', {
      url: 'https://1.1.1.1/health?token=SUPERSECRETTOKEN',
      headers: { Authorization: 'Bearer HEADERSECRET' },
    });
    const res = await get(app, admin, '/monitors');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('SUPERSECRETTOKEN');
    expect(text).not.toContain('HEADERSECRET');
    expect(text).not.toContain((await Monitor.findById(cron.body.data.id).lean()).heartbeatToken);
    expect(res.body.data.find((m) => m.id === secretUrl.id).url).toBe('https://1.1.1.1/health?…');
  });
});

describe('incidents', () => {
  it('lists every incident, filtered, and shows a timeline', async () => {
    const shop = await addMonitor(app, alice, 'Shop');
    const api = await addMonitor(app, bob, 'Bobs API');
    const open = await Incident.create({
      monitorId: shop.id,
      workspaceId: alice.workspaceId,
      startedAt: new Date(Date.now() - 7200e3),
      cause: 'HTTP 503',
      causeCode: 'HTTP_503',
      timeline: [{ type: 'opened', message: 'Opened: HTTP 503' }],
    });
    await Incident.create({
      monitorId: api.id,
      workspaceId: bob.workspaceId,
      startedAt: new Date(Date.now() - 86400e3),
      resolvedAt: new Date(Date.now() - 80000e3),
      durationSec: 6400,
      cause: 'Timeout',
      causeCode: 'ETIMEDOUT',
    });
    const all = await get(app, admin, '/incidents');
    expect(all.body.pagination.total).toBe(2);
    expect(all.body.data[0]).toMatchObject({
      monitorName: 'Shop',
      workspace: { id: alice.workspaceId },
      resolvedAt: null,
    });
    const ids = async (q) =>
      (await get(app, admin, `/incidents?${q}`)).body.data.map((i) => i.monitorName);
    expect(await ids('status=open')).toEqual(['Shop']);
    expect(await ids('status=resolved')).toEqual(['Bobs API']);
    expect(await ids(`workspaceId=${bob.workspaceId}`)).toEqual(['Bobs API']);
    expect(await ids(`monitorId=${shop.id}`)).toEqual(['Shop']);
    expect(await ids('search=timeout')).toEqual(['Bobs API']);
    expect((await get(app, admin, '/incidents?limit=1&page=2')).body.data).toHaveLength(1);

    const detail = await get(app, admin, `/incidents/${open._id}`);
    expect(detail.body.data.timeline).toEqual([
      expect.objectContaining({ type: 'opened', message: 'Opened: HTTP 503' }),
    ]);
    expect((await get(app, admin, '/incidents/nope')).status).toBe(404);
  });
});

describe('overview and system health', () => {
  it('counts users, workspaces, monitors by type and status, incidents and 30 days of checks', async () => {
    await addMonitor(app, alice, 'Shop');
    const down = await addMonitor(app, bob, 'Bobs API');
    await Monitor.updateOne({ _id: down.id }, { $set: { status: 'down' } });
    await request(app)
      .post(`/api/v1/workspaces/${bob.workspaceId}/monitors`)
      .set(bob.auth)
      .send({ name: 'Nightly', type: 'heartbeat', expectedEverySec: 3600 });
    await Incident.create({
      monitorId: down.id,
      workspaceId: bob.workspaceId,
      startedAt: new Date(),
      cause: 'x',
    });
    await post(app, admin, `/users/${carol.user.id}/suspend`, { reason: 'test' });

    const o = (await get(app, admin, '/overview')).body.data;
    expect(o.users).toMatchObject({ total: 4, new7: 4, new30: 4, suspended: 1 });
    expect(o.workspaces).toMatchObject({ total: 4, suspended: 0 });
    expect(o.monitors).toMatchObject({ total: 3, failingNow: 1 });
    expect(o.monitors.byType).toMatchObject({ http: 2, heartbeat: 1, agent: 0 });
    expect(o.monitors.byStatus.down).toBe(1);
    expect(o.incidents).toMatchObject({ open: 1, last30: 1 });
    expect(o.checksPerDay).toHaveLength(30);
    expect(o.checksPerDay.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.checks === 0)).toBe(
      true,
    );
    expect(o.alerts).toMatchObject({ since: null, perChannel: { email: { sent: 0, failed: 0 } } });
    expect(o.requestsSaved).toMatchObject({ requestsSaved: 43200 }); // one push monitor vs polling every minute
  });

  it('counts alerts sent and failed per channel from the alert log', async () => {
    await AlertLog.create([
      { channelType: 'email', ok: true },
      { channelType: 'email', ok: false, error: 'Resend rejected the email (403)' },
      { channelType: 'discord', ok: true },
      { channelType: 'slack', ok: false, error: 'Slack answered 404' },
    ]);
    const o = (await get(app, admin, '/overview')).body.data;
    expect(o.alerts.since).toBeTruthy();
    expect(o.alerts.perChannel).toEqual({
      email: { sent: 1, failed: 1 },
      discord: { sent: 1, failed: 0 },
      slack: { sent: 0, failed: 1 },
    });
  });

  it('reports api, worker, queue, change streams, alert failures and recent server errors', async () => {
    await AlertLog.create({
      channelType: 'email',
      ok: false,
      error: 'Brevo rejected the email (401)',
    });
    await ErrorLog.create({
      method: 'GET',
      route: '/api/v1/workspaces/:id/monitors',
      status: 500,
      code: 'INTERNAL',
      message: 'boom',
    });
    const s = (await get(app, admin, '/system')).body.data;
    expect(s.api).toMatchObject({ status: 'ok', uptimeSec: expect.any(Number) });
    expect(s.worker.status).toBe('unknown'); // no worker has run in this test database
    expect(s.queue).toMatchObject({ pending: expect.any(Number), running: 0, failed: 0 });
    expect(s.changeStreams).toBe('not_started');
    expect(s.alertFailures.last24h).toEqual({ email: 1, discord: 0, slack: 0 });
    expect(s.alertFailures.recent[0]).toMatchObject({
      channelType: 'email',
      error: 'Brevo rejected the email (401)',
    });
    expect(s.errors[0]).toMatchObject({
      route: '/api/v1/workspaces/:id/monitors',
      status: 500,
      message: 'boom',
    });
  });

  it('records an unexpected server error without bodies, ids, query strings or URLs', async () => {
    const mini = express();
    mini.use(express.json());
    mini.post('/api/v1/workspaces/:wid/things/:tid', () => {
      throw new Error('connect failed to mongodb://user:PASSWORD@host/db while handling');
    });
    mini.use(errorHandler);
    const wid = 'a'.repeat(24);
    await request(mini)
      .post(`/api/v1/workspaces/${wid}/things/${'b'.repeat(24)}?token=QUERYSECRET`)
      .send({ password: 'BODYSECRET' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const row = await ErrorLog.findOne().lean();
    expect(row).toMatchObject({ method: 'POST', status: 500, code: 'INTERNAL' });
    // The route pattern, never the URL that was requested.
    expect(row.route).toBe('/api/v1/workspaces/:wid/things/:tid');
    // And a mounted router's base URL carries real ids, which are masked.
    expect(
      routePattern({ baseUrl: `/api/v1/workspaces/${wid}/monitors`, route: { path: '/:mid' } }),
    ).toBe('/api/v1/workspaces/:id/monitors/:mid');
    const stored = JSON.stringify(row);
    for (const secret of ['QUERYSECRET', 'BODYSECRET', 'PASSWORD', 'mongodb://', wid]) {
      expect(stored).not.toContain(secret);
    }
  });
});

describe('privacy: secrets never appear in an admin response', () => {
  it('shows none of the stored secrets on any admin endpoint', async () => {
    // Plant a recognisable secret in every place one can live.
    const shop = await addMonitor(app, alice, 'Shop', {
      headers: { 'X-Api-Key': 'HEADER-SECRET-VALUE' },
    });
    const agent = await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/monitors`)
      .set(alice.auth)
      .send({ name: 'App', type: 'agent', reportEverySec: 60 });
    const hb = await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/monitors`)
      .set(alice.auth)
      .send({ name: 'Cron', type: 'heartbeat', expectedEverySec: 3600 });
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/alert-channels`)
      .set(alice.auth)
      .send({
        type: 'slack',
        name: 'ops',
        target: 'https://hooks.slack.com/services/T000/B000/WEBHOOKSECRETXYZ9',
      });
    await User.updateOne(
      { email: 'alice@example.com' },
      {
        $push: {
          identities: {
            provider: 'github',
            providerId: '77',
            tokenEnc: 'v1.OAUTH-TOKEN-SECRET.aaa.bbb',
            login: 'alice',
          },
        },
      },
    );
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'password123' });
    const refreshToken = decodeURIComponent(refreshCookie(login).split('=')[1]);

    const hbDoc = await Monitor.findById(hb.body.data.id).lean();
    const agentDoc = await Monitor.findById(agent.body.data.id).lean();
    const userDoc = await User.findOne({ email: 'alice@example.com' })
      .select('+passwordHash')
      .lean();
    const sessionDoc = await Session.findOne({ userId: alice.user.id }).lean();
    const secrets = [
      'HEADER-SECRET-VALUE',
      'WEBHOOKSECRETXYZ9',
      'OAUTH-TOKEN-SECRET',
      agent.body.data.agentKey,
      agentDoc.agentKeyHash,
      hbDoc.heartbeatToken,
      userDoc.passwordHash,
      sessionDoc.tokenHash,
      refreshToken,
      alice.accessToken,
    ].filter(Boolean);
    expect(secrets.length).toBeGreaterThanOrEqual(9);

    await Incident.create({
      monitorId: shop.id,
      workspaceId: alice.workspaceId,
      startedAt: new Date(),
      cause: 'x',
    });
    const paths = [
      '/overview',
      '/system',
      '/audit',
      '/users?limit=100',
      `/users/${alice.user.id}`,
      '/workspaces',
      `/workspaces/${alice.workspaceId}`,
      '/monitors',
      `/monitors/${shop.id}`,
      '/incidents',
    ];
    for (const path of paths) {
      const res = await get(app, admin, path);
      expect(res.status, path).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of secrets) expect(text, `${path} leaked a secret`).not.toContain(secret);
      for (const word of [
        'passwordHash',
        'tokenHash',
        'tokenEnc',
        'agentKeyHash',
        'heartbeatToken',
      ]) {
        expect(text, `${path} has the field ${word}`).not.toContain(word);
      }
    }
    // The shape the channel is shown in: the last four characters of a webhook, nothing more.
    const detail = (await get(app, admin, `/users/${alice.user.id}`)).body.data;
    expect(detail.alertChannels.find((c) => c.type === 'slack').targetMasked).toBe('…XYZ9');
    expect(await AlertChannel.countDocuments()).toBe(1);
  });
});
