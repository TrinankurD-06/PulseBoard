import { DEMO_USER_EMAIL, PLATFORM_ROLES } from '@pulseboard/shared/constants';
import { User } from '@pulseboard/shared/models';
import request from 'supertest';
import { buildTestApp, registerUser } from './helpers.js';

/** Records scheduler calls so a test can see jobs being cancelled and created. */
export function fakeScheduler() {
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

export const kinds = (scheduler) => scheduler.calls.map((call) => call[0]);

/** An app with the admin console on and nothing configured to make anyone an admin by itself. */
export function buildAdminApp(scheduler = fakeScheduler(), env = {}) {
  return buildTestApp({
    scheduler,
    env: { ALLOW_PRIVATE_TARGETS: false, DEMO_MODE: false, ADMIN_EMAILS: [], ...env },
  });
}

/** Signs up a user and, if asked, makes them a superadmin the only way possible: in the database. */
export async function signUp(app, { name, email, admin = false } = {}) {
  const user = await registerUser(app, { name, email });
  if (admin) {
    await User.updateOne(
      { email: user.user.email },
      { $set: { platformRole: PLATFORM_ROLES.SUPERADMIN } },
    );
  }
  return user;
}

export async function signUpDemo(app) {
  return registerUser(app, { name: 'Demo User', email: DEMO_USER_EMAIL });
}

export async function addMonitor(app, user, name = 'Shop', body = {}) {
  const res = await request(app)
    .post(`/api/v1/workspaces/${user.workspaceId}/monitors`)
    .set(user.auth)
    .send({ name, url: 'https://1.1.1.1/', intervalSec: 60, ...body });
  if (res.status !== 201) throw new Error(`monitor create failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export const get = (app, who, path) => request(app).get(`/api/v1/admin${path}`).set(who.auth);
export const post = (app, who, path, body) =>
  request(app)
    .post(`/api/v1/admin${path}`)
    .set(who.auth)
    .send(body ?? {});
export const del = (app, who, path, body) =>
  request(app)
    .delete(`/api/v1/admin${path}`)
    .set(who.auth)
    .send(body ?? {});
