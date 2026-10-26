import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp();

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let owner, member, viewer, outsider, wid;

beforeEach(async () => {
  await clearMemoryDb();
  owner = await registerUser(app, { name: 'Owner' });
  member = await registerUser(app, { name: 'Member' });
  viewer = await registerUser(app, { name: 'Viewer' });
  outsider = await registerUser(app, { name: 'Outsider' });
  wid = owner.workspaceId;

  for (const [user, role] of [
    [member, 'member'],
    [viewer, 'viewer'],
  ]) {
    const res = await request(app)
      .post(`/api/v1/workspaces/${wid}/members`)
      .set(owner.auth)
      .send({ email: user.user.email, role });
    expect(res.status).toBe(201);
  }
});

const ws = (path = '') => `/api/v1/workspaces/${wid}${path}`;

describe('workspace access', () => {
  it('lets every member read the workspace with their own role', async () => {
    for (const [user, role] of [
      [owner, 'owner'],
      [member, 'member'],
      [viewer, 'viewer'],
    ]) {
      const res = await request(app).get(ws()).set(user.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe(role);
    }
  });

  it('returns 404 (not 403) to non-members, hiding that the workspace exists', async () => {
    const res = await request(app).get(ws()).set(outsider.auth);
    expect(res.status).toBe(404);
  });

  it('returns 404 for malformed workspace ids', async () => {
    const res = await request(app).get('/api/v1/workspaces/not-an-id').set(owner.auth);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await request(app).get(ws())).status).toBe(401);
  });
});

describe('workspace settings (owner only)', () => {
  it('lets the owner rename, but not members or viewers', async () => {
    const rename = (user) => request(app).patch(ws()).set(user.auth).send({ name: 'Renamed' });
    expect((await rename(viewer)).status).toBe(403);
    expect((await rename(member)).status).toBe(403);
    const res = await rename(owner);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
  });

  it('lets only the owner delete the workspace', async () => {
    expect((await request(app).delete(ws()).set(member.auth)).status).toBe(403);
    expect((await request(app).delete(ws()).set(owner.auth)).status).toBe(204);
    expect((await request(app).get(ws()).set(owner.auth)).status).toBe(404);
  });
});

describe('members', () => {
  it('lets every role list members', async () => {
    const res = await request(app).get(ws('/members')).set(viewer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toMatchObject({ name: 'Owner', role: 'owner' });
    expect(res.body.pagination).toMatchObject({ page: 1, total: 3 });
  });

  it('does not let a viewer or member add members', async () => {
    const add = (user) =>
      request(app)
        .post(ws('/members'))
        .set(user.auth)
        .send({ email: outsider.user.email, role: 'viewer' });
    expect((await add(viewer)).status).toBe(403);
    expect((await add(member)).status).toBe(403);
  });

  it('does not let a member remove or re-role members', async () => {
    const remove = await request(app)
      .delete(ws(`/members/${viewer.user.id}`))
      .set(member.auth);
    expect(remove.status).toBe(403);
    const promote = await request(app)
      .patch(ws(`/members/${member.user.id}`))
      .set(member.auth)
      .send({ role: 'owner' });
    expect(promote.status).toBe(403);
  });

  it('lets the owner change roles and remove members', async () => {
    const promote = await request(app)
      .patch(ws(`/members/${viewer.user.id}`))
      .set(owner.auth)
      .send({ role: 'member' });
    expect(promote.status).toBe(200);
    expect(promote.body.data.role).toBe('member');

    const remove = await request(app)
      .delete(ws(`/members/${member.user.id}`))
      .set(owner.auth);
    expect(remove.status).toBe(204);
    expect((await request(app).get(ws()).set(member.auth)).status).toBe(404);
  });

  it('never leaves a workspace without an owner', async () => {
    const demote = await request(app)
      .patch(ws(`/members/${owner.user.id}`))
      .set(owner.auth)
      .send({ role: 'member' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('LAST_OWNER');

    const remove = await request(app)
      .delete(ws(`/members/${owner.user.id}`))
      .set(owner.auth);
    expect(remove.status).toBe(409);
  });

  it('allows demoting an owner once another owner exists', async () => {
    await request(app)
      .patch(ws(`/members/${member.user.id}`))
      .set(owner.auth)
      .send({ role: 'owner' });
    const demote = await request(app)
      .patch(ws(`/members/${owner.user.id}`))
      .set(owner.auth)
      .send({ role: 'member' });
    expect(demote.status).toBe(200);
  });

  it('explains unknown emails and duplicate members', async () => {
    const unknown = await request(app)
      .post(ws('/members'))
      .set(owner.auth)
      .send({ email: 'ghost@example.com', role: 'viewer' });
    expect(unknown.status).toBe(404);

    const duplicate = await request(app)
      .post(ws('/members'))
      .set(owner.auth)
      .send({ email: member.user.email, role: 'viewer' });
    expect(duplicate.status).toBe(409);
  });
});

describe('GET /workspaces (list + pagination)', () => {
  it('lists only my workspaces, with my role, paginated', async () => {
    for (const name of ['Second', 'Third']) {
      await request(app).post('/api/v1/workspaces').set(owner.auth).send({ name });
    }

    const page1 = await request(app).get('/api/v1/workspaces?limit=2').set(owner.auth);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const memberView = await request(app).get('/api/v1/workspaces').set(member.auth);
    expect(memberView.body.data.map((w) => w.role).sort()).toEqual(['member', 'owner']);
  });

  it('caps limit at 100', async () => {
    const res = await request(app).get('/api/v1/workspaces?limit=500').set(owner.auth);
    expect(res.status).toBe(400);
  });
});
