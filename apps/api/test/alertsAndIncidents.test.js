import { mongoose } from '@pulseboard/shared/db';
import { Incident, Monitor } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

const sent = [];
let failDelivery = false;
const alertSenders = {
  discord: async (target, alert) => {
    if (failDelivery) throw new Error('HTTP 404: Unknown Webhook');
    sent.push({ target, title: alert.title, link: alert.link });
  },
  slack: async () => {},
  email: async () => ({ previewUrl: 'https://ethereal.email/message/xyz' }),
};
const app = buildTestApp({ alertSenders });

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let owner, viewer, wid;
const DISCORD = 'https://discord.com/api/webhooks/123/secret-token';
const ws = (path) => `/api/v1/workspaces/${wid}${path}`;

beforeEach(async () => {
  await clearMemoryDb();
  sent.length = 0;
  failDelivery = false;
  owner = await registerUser(app, { name: 'Owner' });
  viewer = await registerUser(app, { name: 'Viewer' });
  wid = owner.workspaceId;
  await request(app)
    .post(ws('/members'))
    .set(owner.auth)
    .send({ email: viewer.user.email, role: 'viewer' });
});

async function createChannel(body = { name: 'Ops', type: 'discord', target: DISCORD }) {
  const res = await request(app).post(ws('/alert-channels')).set(owner.auth).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('alert channels', () => {
  it('creates, lists, toggles and deletes a channel', async () => {
    const channel = await createChannel();
    expect(channel).toMatchObject({ type: 'discord', target: DISCORD, isEnabled: true });

    const toggled = await request(app)
      .patch(ws(`/alert-channels/${channel.id}`))
      .set(owner.auth)
      .send({ isEnabled: false });
    expect(toggled.body.data.isEnabled).toBe(false);

    const list = await request(app).get(ws('/alert-channels')).set(owner.auth);
    expect(list.body.data).toHaveLength(1);

    await request(app)
      .delete(ws(`/alert-channels/${channel.id}`))
      .set(owner.auth)
      .expect(204);
    expect((await request(app).get(ws('/alert-channels')).set(owner.auth)).body.data).toEqual([]);
  });

  it('validates that the target matches the type', async () => {
    const res = await request(app)
      .post(ws('/alert-channels'))
      .set(owner.auth)
      .send({ type: 'slack', target: DISCORD });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('target');
  });

  it('re-validates a type change against the existing target', async () => {
    const channel = await createChannel();
    const res = await request(app)
      .patch(ws(`/alert-channels/${channel.id}`))
      .set(owner.auth)
      .send({ type: 'email' });
    expect(res.status).toBe(400);
  });

  it('masks webhook URLs and emails for viewers, and blocks their changes', async () => {
    await createChannel();
    await createChannel({ type: 'email', target: 'oncall@example.com' });
    const res = await request(app).get(ws('/alert-channels')).set(viewer.auth);
    expect(res.body.data.map((c) => c.target)).toEqual([
      'https://discord.com/•••',
      'o•••@example.com',
    ]);

    const create = await request(app)
      .post(ws('/alert-channels'))
      .set(viewer.auth)
      .send({ type: 'email', target: 'x@example.com' });
    expect(create.status).toBe(403);
  });

  it('sends a test alert through the channel', async () => {
    const channel = await createChannel();
    const res = await request(app)
      .post(ws(`/alert-channels/${channel.id}/test`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ target: DISCORD, title: 'Test alert from PulseBoard' });
  });

  it('links a test alert to the Alert channels page, not to a monitor that does not exist', async () => {
    const channel = await createChannel();
    await request(app)
      .post(ws(`/alert-channels/${channel.id}/test`))
      .set(owner.auth);
    // DASHBOARD_URL comes from the test env (http://localhost:5173).
    expect(sent[0].link).toBe(`http://localhost:5173/app/${wid}/alerts`);
    expect(sent[0].link).not.toContain('/monitors/');
  });

  it('reports a delivery failure as 502 with the reason', async () => {
    const channel = await createChannel();
    failDelivery = true;
    const res = await request(app)
      .post(ws(`/alert-channels/${channel.id}/test`))
      .set(owner.auth);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'ALERT_DELIVERY_FAILED',
      message: 'Could not deliver: HTTP 404: Unknown Webhook',
    });
  });
});

describe('incidents', () => {
  let monitor;

  beforeEach(async () => {
    monitor = await Monitor.create({
      workspaceId: wid,
      name: 'Checkout',
      url: 'https://shop.example',
      intervalSec: 30,
      status: 'down',
    });
    await Incident.create([
      {
        monitorId: monitor._id,
        workspaceId: wid,
        startedAt: new Date('2026-01-01T10:00:00Z'),
        resolvedAt: new Date('2026-01-01T10:05:00Z'),
        durationSec: 300,
        cause: 'Connection refused',
      },
      {
        monitorId: monitor._id,
        workspaceId: wid,
        startedAt: new Date('2026-01-02T10:00:00Z'),
        cause: 'Unexpected status 503',
        deliveredAlerts: ['x:down'],
      },
    ]);
  });

  it('lists incidents newest first, with the monitor name, filterable by status', async () => {
    const all = await request(app).get(ws('/incidents')).set(viewer.auth);
    expect(all.status).toBe(200);
    expect(all.body.data.map((i) => i.cause)).toEqual([
      'Unexpected status 503',
      'Connection refused',
    ]);
    expect(all.body.data[0].monitor).toEqual({
      id: String(monitor._id),
      name: 'Checkout',
      url: 'https://shop.example',
    });
    expect(all.body.data[0].deliveredAlerts).toBeUndefined();

    const open = await request(app).get(ws('/incidents?status=open')).set(viewer.auth);
    expect(open.body.data).toHaveLength(1);
    const resolved = await request(app).get(ws('/incidents?status=resolved')).set(viewer.auth);
    expect(resolved.body.data[0].durationSec).toBe(300);
  });

  it('filters by monitor and fetches a single incident', async () => {
    const other = new mongoose.Types.ObjectId();
    const filtered = await request(app)
      .get(ws(`/incidents?monitorId=${other}`))
      .set(owner.auth);
    expect(filtered.body.data).toEqual([]);

    const [first] = (await request(app).get(ws('/incidents')).set(owner.auth)).body.data;
    const single = await request(app)
      .get(ws(`/incidents/${first.id}`))
      .set(owner.auth);
    expect(single.body.data.cause).toBe('Unexpected status 503');
    expect((await request(app).get(ws('/incidents/nope')).set(owner.auth)).status).toBe(404);
  });

  it('pausing a monitor closes its open incident', async () => {
    await request(app)
      .post(ws(`/monitors/${monitor._id}/pause`))
      .set(owner.auth)
      .expect(200);
    const open = await Incident.countDocuments({ resolvedAt: null });
    expect(open).toBe(0);
    const closed = await Incident.findOne({ cause: 'Unexpected status 503' }).lean();
    expect(closed.timeline.at(-1)).toMatchObject({
      type: 'resolved',
      message: 'Closed because monitoring was paused',
    });
    expect(closed.durationSec).toBeGreaterThan(0);
  });
});
