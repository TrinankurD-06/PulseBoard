import { DEMO_USER_EMAIL, PAUSED_REASONS } from '@pulseboard/shared/constants';
import { ensureReadOnlyDemo } from '@pulseboard/shared/demo';
import { Membership, Monitor, User } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureAdminAccount, isAdminEmail } from '../src/modules/admin/admin.service.js';
import { buildTestApp, registerUser, testEnv } from './helpers.js';

/** Records scheduler calls so the tests can see jobs being cancelled and scheduled. */
function fakeScheduler() {
  const calls = [];
  return {
    calls,
    async scheduleMonitor(monitor) {
      calls.push(['schedule', String(monitor._id)]);
    },
    async cancelMonitor(monitorId) {
      calls.push(['cancel', String(monitorId)]);
    },
  };
}

const ADMIN_EMAIL = 'boss@example.com';
const ADMIN_PASSWORD = 'a-long-admin-password';
const scheduler = fakeScheduler();
const env = { ADMIN_EMAIL, ADMIN_PASSWORD, ALLOW_PRIVATE_TARGETS: false, DEMO_MODE: false };
const app = buildTestApp({ scheduler, env });

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let admin, alice, bob;
const validMonitor = (name) => ({ name, url: 'https://1.1.1.1/', intervalSec: 60 });

async function addMonitor(user, name) {
  const res = await request(app)
    .post(`/api/v1/workspaces/${user.workspaceId}/monitors`)
    .set(user.auth)
    .send(validMonitor(name));
  expect(res.status).toBe(201);
  return res.body.data;
}

const stopOrStart = (uid, action, who = admin) =>
  request(app).post(`/api/v1/admin/users/${uid}/monitors`).set(who.auth).send({ action });

const rowFor = async (email) => {
  const res = await request(app).get('/api/v1/admin/users?limit=100').set(admin.auth);
  return res.body.data.find((row) => row.email === email);
};

beforeEach(async () => {
  await clearMemoryDb();
  scheduler.calls.length = 0;
  admin = await registerUser(app, { name: 'Boss', email: ADMIN_EMAIL });
  alice = await registerUser(app, { name: 'Alice', email: 'alice@example.com' });
  bob = await registerUser(app, { name: 'Bob', email: 'bob@example.com' });
});

describe('who is the administrator', () => {
  it('is the account with ADMIN_EMAIL, compared case-insensitively, and nobody if it is unset', () => {
    expect(isAdminEmail({ ADMIN_EMAIL }, 'BOSS@Example.com')).toBe(true);
    expect(isAdminEmail({ ADMIN_EMAIL }, 'alice@example.com')).toBe(false);
    expect(isAdminEmail({}, 'boss@example.com')).toBe(false);
    expect(isAdminEmail({ ADMIN_EMAIL }, undefined)).toBe(false);
  });

  it('is reported to the client by /auth/me, and only for the administrator', async () => {
    const mine = await request(app).get('/api/v1/auth/me').set(admin.auth);
    const theirs = await request(app).get('/api/v1/auth/me').set(alice.auth);
    expect(mine.body.data.isAdmin).toBe(true);
    expect(theirs.body.data.isAdmin).toBe(false);
  });

  it('answers 404 to everyone else, so the panel does not reveal itself', async () => {
    for (const who of [alice, { auth: {} }]) {
      const res = await request(app).get('/api/v1/admin/users').set(who.auth);
      expect([401, 404]).toContain(res.status);
    }
    expect((await request(app).get('/api/v1/admin/users').set(alice.auth)).status).toBe(404);
    expect((await stopOrStart(bob.user.id, 'stop', alice)).status).toBe(404);
    // And with no admin configured at all, not even the ADMIN_EMAIL account gets in.
    const noAdminApp = buildTestApp({ scheduler, env: { ADMIN_EMAIL: undefined } });
    const login = await request(noAdminApp)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'password123' });
    const res = await request(noAdminApp)
      .get('/api/v1/admin/users')
      .set({ Authorization: `Bearer ${login.body.data.accessToken}` });
    expect(res.status).toBe(404);
  });
});

describe('listing users', () => {
  it('shows every user with workspaces, roles and monitor counts', async () => {
    await addMonitor(alice, 'Shop');
    await addMonitor(alice, 'Blog');
    const res = await request(app).get('/api/v1/admin/users').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ total: 3, page: 1 });
    const row = res.body.data.find((user) => user.email === 'alice@example.com');
    expect(row).toMatchObject({
      name: 'Alice',
      isDemo: false,
      monitors: { total: 2, running: 2, paused: 0, stoppedByAdmin: 0 },
    });
    expect(row.workspaces[0]).toMatchObject({ role: 'owner', managed: true });
    expect(row.lastSeenAt).toBeTruthy();
  });

  it('never leaks secrets: no password hash, no provider tokens', async () => {
    await User.updateOne(
      { email: 'alice@example.com' },
      {
        $push: {
          identities: { provider: 'github', providerId: '1', tokenEnc: 'v1.secret.secret.secret' },
        },
      },
    );
    const res = await request(app).get('/api/v1/admin/users?limit=100').set(admin.auth);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('tokenEnc');
    expect(text).not.toContain('v1.secret');
    expect(res.body.data.find((u) => u.email === 'alice@example.com').providers).toEqual([
      'github',
    ]);
  });

  it('searches by name or email and pages the results', async () => {
    const byName = await request(app).get('/api/v1/admin/users?search=ali').set(admin.auth);
    expect(byName.body.data.map((u) => u.name)).toEqual(['Alice']);
    const byEmail = await request(app).get('/api/v1/admin/users?search=BOB@').set(admin.auth);
    expect(byEmail.body.data.map((u) => u.name)).toEqual(['Bob']);
    const weird = await request(app).get('/api/v1/admin/users?search=.*').set(admin.auth);
    expect(weird.body.data).toHaveLength(0); // a regex in the box is just text
    const paged = await request(app).get('/api/v1/admin/users?limit=2&page=2').set(admin.auth);
    expect(paged.body.data).toHaveLength(2 - 1);
    expect(paged.body.pagination).toMatchObject({ total: 3, page: 2, limit: 2 });
  });

  it('includes the demo user, whose managed workspace is the one it is a viewer of', async () => {
    const demo = await registerUser(app, { name: 'Demo User', email: DEMO_USER_EMAIL });
    await addMonitor(demo, 'Demo API');
    await ensureReadOnlyDemo({}); // demo becomes a viewer; a login-less owner takes the workspace
    const row = await rowFor(DEMO_USER_EMAIL);
    expect(row.isDemo).toBe(true);
    expect(row.workspaces[0]).toMatchObject({ role: 'viewer', managed: true });
    expect(row.monitors.total).toBe(1);
  });

  it('counts only workspaces the user owns, not ones they were invited to', async () => {
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: bob.user.email, role: 'member' });
    await addMonitor(alice, 'Shop');
    const bobRow = await rowFor('bob@example.com');
    expect(bobRow.workspaces).toHaveLength(2);
    expect(bobRow.monitors.total).toBe(0); // Alice's monitor is Alice's
  });
});

describe('stop and start', () => {
  it('stops every running monitor of the user, cancelling their jobs, and starts them again', async () => {
    const shop = await addMonitor(alice, 'Shop');
    const blog = await addMonitor(alice, 'Blog');
    await addMonitor(bob, 'Not Alice');
    scheduler.calls.length = 0;

    const stopped = await stopOrStart(alice.user.id, 'stop');
    expect(stopped.status).toBe(200);
    expect(stopped.body.data).toMatchObject({ changed: 2, skipped: 0, failed: [] });
    expect(scheduler.calls.map((call) => call[0])).toEqual(['cancel', 'cancel']);
    for (const monitor of [shop, blog]) {
      expect(await Monitor.findById(monitor.id).lean()).toMatchObject({
        isPaused: true,
        status: 'paused',
        pausedReason: PAUSED_REASONS.ADMIN,
      });
    }
    expect((await rowFor('alice@example.com')).monitors).toMatchObject({
      running: 0,
      stoppedByAdmin: 2,
    });
    // Nobody else is touched.
    expect((await rowFor('bob@example.com')).monitors).toMatchObject({ total: 1, running: 1 });

    scheduler.calls.length = 0;
    const started = await stopOrStart(alice.user.id, 'start');
    expect(started.body.data).toMatchObject({ changed: 2, failed: [] });
    expect(scheduler.calls.map((call) => call[0])).toEqual(['schedule', 'schedule']);
    expect(await Monitor.findById(shop.id).lean()).toMatchObject({
      isPaused: false,
      status: 'pending',
      pausedReason: null,
    });
  });

  it('is a no-op the second time (stop twice, start twice)', async () => {
    await addMonitor(alice, 'Shop');
    await stopOrStart(alice.user.id, 'stop');
    expect((await stopOrStart(alice.user.id, 'stop')).body.data).toMatchObject({
      changed: 0,
      skipped: 1,
    });
    await stopOrStart(alice.user.id, 'start');
    expect((await stopOrStart(alice.user.id, 'start')).body.data).toMatchObject({
      changed: 0,
      skipped: 1,
    });
  });

  it('does not start a monitor the user paused themselves', async () => {
    const mine = await addMonitor(alice, 'Paused by me');
    await addMonitor(alice, 'Running');
    await request(app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/monitors/${mine.id}/pause`)
      .set(alice.auth);
    await stopOrStart(alice.user.id, 'stop'); // only the running one is stopped by the admin
    await stopOrStart(alice.user.id, 'start'); // and only that one is started again
    expect(await Monitor.findById(mine.id).lean()).toMatchObject({
      isPaused: true,
      pausedReason: PAUSED_REASONS.USER,
    });
    expect((await rowFor('alice@example.com')).monitors).toMatchObject({
      running: 1,
      paused: 1,
      stoppedByAdmin: 0,
    });
  });

  it('keeps the user from undoing it: resume is refused, pausing again changes nothing', async () => {
    const shop = await addMonitor(alice, 'Shop');
    await stopOrStart(alice.user.id, 'stop');
    const base = `/api/v1/workspaces/${alice.workspaceId}/monitors/${shop.id}`;

    const resume = await request(app).post(`${base}/resume`).set(alice.auth);
    expect(resume.status).toBe(403);
    expect(resume.body.error.code).toBe('STOPPED_BY_ADMIN');
    await request(app).post(`${base}/pause`).set(alice.auth); // would re-label it as the user's own
    expect((await request(app).post(`${base}/resume`).set(alice.auth)).status).toBe(403);
    expect((await Monitor.findById(shop.id).lean()).pausedReason).toBe(PAUSED_REASONS.ADMIN);
  });

  it("stops the demo user's workspace monitors even though the demo user is only a viewer", async () => {
    const demo = await registerUser(app, { name: 'Demo User', email: DEMO_USER_EMAIL });
    const sample = await addMonitor(demo, 'Demo API');
    await ensureReadOnlyDemo({});
    const demoUser = await User.findOne({ email: DEMO_USER_EMAIL }).lean();
    expect((await Membership.findOne({ userId: demoUser._id }).lean()).role).toBe('viewer');

    const res = await stopOrStart(String(demoUser._id), 'stop');
    expect(res.body.data).toMatchObject({ changed: 1 });
    expect((await Monitor.findById(sample.id).lean()).pausedReason).toBe(PAUSED_REASONS.ADMIN);
  });

  it('rejects a bad action and an unknown user', async () => {
    expect((await stopOrStart(alice.user.id, 'explode')).status).toBe(400);
    expect((await stopOrStart('0'.repeat(24), 'stop')).status).toBe(404);
    expect((await stopOrStart('not-an-id', 'stop')).status).toBe(404);
  });
});

describe('ensureAdminAccount', () => {
  const adminEnv = { ADMIN_EMAIL: 'root@example.com', ADMIN_PASSWORD: ADMIN_PASSWORD, ...testEnv };

  it('does nothing unless both the email and the password are set', async () => {
    expect(await ensureAdminAccount({ env: { ...adminEnv, ADMIN_PASSWORD: undefined } })).toBe(
      'disabled',
    );
    expect(await ensureAdminAccount({ env: { ...adminEnv, ADMIN_EMAIL: undefined } })).toBe(
      'disabled',
    );
    expect(await User.exists({ email: 'root@example.com' })).toBeNull();
  });

  it('refuses a short password instead of creating a weak admin, without stopping the API', async () => {
    const warnings = [];
    const logger = { info() {}, warn: (message) => warnings.push(message) };
    const result = await ensureAdminAccount({
      env: { ...adminEnv, ADMIN_PASSWORD: 'tiny' },
      logger,
    });
    expect(result).toBe('weak-password');
    expect(warnings[0]).toMatch(/shorter than 8/);
    expect(await User.exists({ email: 'root@example.com' })).toBeNull();
  });

  it('creates the account with a hashed password and a workspace, then can log in with it', async () => {
    expect(await ensureAdminAccount({ env: adminEnv })).toBe('created');
    const user = await User.findOne({ email: 'root@example.com' }).select('+passwordHash').lean();
    expect(user.passwordHash).not.toContain(ADMIN_PASSWORD);
    expect(await bcrypt.compare(ADMIN_PASSWORD, user.passwordHash)).toBe(true);
    expect(await Membership.countDocuments({ userId: user._id, role: 'owner' })).toBe(1);

    const login = await request(buildTestApp({ scheduler, env: adminEnv }))
      .post('/api/v1/auth/login')
      .send({ email: 'root@example.com', password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('is idempotent, and brings the password in line when the environment changes', async () => {
    await ensureAdminAccount({ env: adminEnv });
    expect(await ensureAdminAccount({ env: adminEnv })).toBe('unchanged');
    const changed = { ...adminEnv, ADMIN_PASSWORD: 'a-different-long-password' };
    expect(await ensureAdminAccount({ env: changed })).toBe('updated');
    const user = await User.findOne({ email: 'root@example.com' }).select('+passwordHash').lean();
    expect(await bcrypt.compare('a-different-long-password', user.passwordHash)).toBe(true);
    expect(await ensureAdminAccount({ env: changed })).toBe('unchanged');
    expect(await User.countDocuments({ email: 'root@example.com' })).toBe(1);
  });
});
