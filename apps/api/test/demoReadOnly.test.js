import { DEMO_OWNER_DEFAULT_EMAIL, DEMO_USER_EMAIL } from '@pulseboard/shared/constants';
import { ensureReadOnlyDemo } from '@pulseboard/shared/demo';
import { Monitor } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp({ env: { DEMO_READ_ONLY: true } });
const openApp = buildTestApp({ env: { DEMO_READ_ONLY: false } });

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let demo, wid, monitorId;
const ws = (path = '') => `/api/v1/workspaces/${wid}${path}`;

beforeEach(async () => {
  await clearMemoryDb();
  demo = await registerUser(app, { name: 'Demo User', email: DEMO_USER_EMAIL });
  wid = demo.workspaceId;
  // A monitor to aim the per-monitor routes at (created directly: the demo user cannot).
  const monitor = await Monitor.create({
    workspaceId: wid,
    name: 'Site',
    url: 'https://example.com',
    intervalSec: 60,
  });
  monitorId = String(monitor._id);
  await ensureReadOnlyDemo();
});

const fakeId = '64b7f0c2a1b2c3d4e5f60718';

// Every route that changes anything. requireRole runs before validation and lookups,
// so a Viewer is refused with 403 whatever the body or ids are.
const mutating = () => [
  ['post', ws('/monitors'), { name: 'x', url: 'https://example.org', intervalSec: 60 }],
  ['patch', ws(`/monitors/${monitorId}`), { name: 'renamed' }],
  ['delete', ws(`/monitors/${monitorId}`)],
  ['post', ws(`/monitors/${monitorId}/pause`)],
  ['post', ws(`/monitors/${monitorId}/resume`)],
  ['post', ws(`/monitors/${monitorId}/test`)],
  ['post', ws(`/monitors/${monitorId}/heartbeat-token`)],
  ['post', ws(`/monitors/${monitorId}/agent-key`)],
  ['post', ws('/alert-channels'), { name: 'c', type: 'email', target: 'a@example.com' }],
  ['patch', ws(`/alert-channels/${fakeId}`), { name: 'c2' }],
  ['delete', ws(`/alert-channels/${fakeId}`)],
  ['post', ws(`/alert-channels/${fakeId}/test`)],
  ['post', ws('/status-pages'), { title: 'T', slug: 'demo-t', monitorIds: [] }],
  ['patch', ws(`/status-pages/${fakeId}`), { title: 'T2' }],
  ['delete', ws(`/status-pages/${fakeId}`)],
  ['post', ws('/members'), { email: 'x@example.com', role: 'member' }],
  ['patch', ws(`/members/${fakeId}`), { role: 'member' }],
  ['delete', ws(`/members/${fakeId}`)],
  ['patch', ws(), { name: 'Hacked' }],
  ['delete', ws()],
];

describe('read-only demo account', () => {
  it('is a Viewer, with the owner account taking over the workspace', async () => {
    const res = await request(app).get(ws()).set(demo.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('viewer');
  });

  it('is refused (403) on every mutating route', async () => {
    for (const [method, path, body] of mutating()) {
      const res = await request(app)[method](path).set(demo.auth).send(body);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
    expect(await Monitor.countDocuments({ workspaceId: wid })).toBe(1);
  });

  it('can still read', async () => {
    for (const path of [
      ws(),
      ws('/monitors'),
      ws(`/monitors/${monitorId}`),
      ws('/alert-channels'),
      ws('/status-pages'),
      ws('/members'),
      ws('/incidents'),
    ]) {
      const res = await request(app).get(path).set(demo.auth);
      expect(res.status, path).toBe(200);
    }
    expect((await request(app).get('/api/v1/workspaces').set(demo.auth)).status).toBe(200);
  });

  it('cannot create a workspace of its own (it would own it)', async () => {
    const res = await request(app).post('/api/v1/workspaces').set(demo.auth).send({ name: 'Mine' });
    expect(res.status).toBe(403);
    const list = await request(app).get('/api/v1/workspaces').set(demo.auth);
    expect(list.body.data.items ?? list.body.data).toHaveLength(1);
  });

  it('still lets other users create workspaces', async () => {
    const other = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/workspaces')
      .set(other.auth)
      .send({ name: 'Mine' });
    expect(res.status).toBe(201);
  });

  it('leaves the owner account without a usable password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: DEMO_OWNER_DEFAULT_EMAIL, password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('reports itself on /meta', async () => {
    const res = await request(app).get('/api/v1/meta');
    expect(res.body.data).toMatchObject({ demoReadOnly: true, demoEmail: DEMO_USER_EMAIL });
  });
});

describe('with DEMO_READ_ONLY off', () => {
  it('reports it on /meta', async () => {
    const res = await request(openApp).get('/api/v1/meta');
    expect(res.body.data).toMatchObject({ demoReadOnly: false, demoEmail: null });
  });

  it('does not block the demo user from creating workspaces', async () => {
    const login = await request(openApp)
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER_EMAIL, password: 'password123' });
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const res = await request(openApp).post('/api/v1/workspaces').set(auth).send({ name: 'Mine' });
    expect(res.status).toBe(201);
  });
});
