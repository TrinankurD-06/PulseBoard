import { DailyRollup, Incident, Monitor } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { addDays, uptimeFromDowntime, utcDayStart } from '@pulseboard/shared/uptime';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTtlCache } from '../src/lib/ttlCache.js';
import { buildTestApp, registerUser } from './helpers.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let app, owner, viewer, wid, api, web;
const pages = (path = '') => `/api/v1/workspaces/${wid}/status-pages${path}`;

beforeEach(async () => {
  await clearMemoryDb();
  app = buildTestApp(); // fresh app = fresh public cache per test
  owner = await registerUser(app, { name: 'Owner' });
  viewer = await registerUser(app, { name: 'Viewer' });
  wid = owner.workspaceId;
  await request(app)
    .post(`/api/v1/workspaces/${wid}/members`)
    .set(owner.auth)
    .send({ email: viewer.user.email, role: 'viewer' });

  const base = { workspaceId: wid, intervalSec: 30, headers: { Authorization: 'Bearer secret' } };
  [api, web] = await Monitor.create([
    { ...base, name: 'API', url: 'https://internal-api.corp.local/health', status: 'up' },
    { ...base, name: 'Website', url: 'https://www.example.com', status: 'down' },
  ]);
});

async function createPage(body = {}) {
  const res = await request(app)
    .post(pages())
    .set(owner.auth)
    .send({
      title: 'Acme Status',
      slug: 'acme',
      monitorIds: [String(api._id), String(web._id)],
      ...body,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('status page CRUD', () => {
  it('creates, lists, updates and deletes a page', async () => {
    const page = await createPage({ description: 'Live status of Acme services' });
    expect(page).toMatchObject({
      slug: 'acme',
      isPublic: true,
      monitorIds: [String(api._id), String(web._id)],
    });

    const list = await request(app).get(pages()).set(viewer.auth);
    expect(list.body.data).toHaveLength(1);

    const updated = await request(app)
      .patch(pages(`/${page.id}`))
      .set(owner.auth)
      .send({ title: 'Acme', monitorIds: [String(web._id)] });
    expect(updated.body.data).toMatchObject({
      title: 'Acme',
      slug: 'acme',
      monitorIds: [String(web._id)],
    });

    await request(app)
      .delete(pages(`/${page.id}`))
      .set(owner.auth)
      .expect(204);
    expect((await request(app).get(pages()).set(owner.auth)).body.data).toEqual([]);
  });

  it('rejects a taken slug with a field error', async () => {
    await createPage();
    const res = await request(app)
      .post(pages())
      .set(owner.auth)
      .send({ title: 'Other', slug: 'acme' });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].path).toBe('slug');
  });

  it('refuses monitors from another workspace', async () => {
    const other = await registerUser(app);
    const [foreign] = await Monitor.create([
      { workspaceId: other.workspaceId, name: 'Theirs', url: 'https://x.example', intervalSec: 30 },
    ]);
    const res = await request(app)
      .post(pages())
      .set(owner.auth)
      .send({ title: 'x', slug: 'mixed', monitorIds: [String(foreign._id)] });
    expect(res.status).toBe(400);
  });

  it('does not let viewers create or change pages', async () => {
    const page = await createPage();
    expect(
      (await request(app).post(pages()).set(viewer.auth).send({ title: 'x', slug: 'xyz' })).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(pages(`/${page.id}`))
          .set(viewer.auth)
      ).status,
    ).toBe(403);
  });
});

describe('GET /public/status/:slug', () => {
  const getPublic = (slug = 'acme') => request(app).get(`/api/v1/public/status/${slug}`);

  beforeEach(async () => {
    const today = utcDayStart(new Date());
    await DailyRollup.create([
      {
        monitorId: api._id,
        workspaceId: wid,
        date: addDays(today, -1),
        totalChecks: 100,
        upChecks: 99,
        downtimeSec: 864,
        coveredSec: 86_400,
      },
      {
        monitorId: api._id,
        workspaceId: wid,
        date: today,
        totalChecks: 100,
        upChecks: 100,
        coveredSec: 86_400,
      },
    ]);
    await Incident.create({
      monitorId: web._id,
      workspaceId: wid,
      startedAt: new Date(Date.now() - 60_000),
      cause: 'Connection refused to 10.0.3.7:5432',
    });
  });

  it('works without login and returns status, 90 days of bars and incidents', async () => {
    await createPage();
    const res = await getPublic();

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    const body = res.body.data;
    expect(body).toMatchObject({ title: 'Acme Status', overall: 'partial_outage' });
    // Yesterday (864 s down of 86,400 watched) plus today computed live up to now; the stale
    // rollup for today is ignored. Today's watched time comes from the clock.
    const sinceMidnight = Math.round((Date.now() - utcDayStart(new Date()).getTime()) / 1000);
    const expectedUptime90 = uptimeFromDowntime(864, 86_400 + sinceMidnight);
    expect(body.monitors.map((m) => [m.name, m.status])).toEqual([
      ['API', 'up'],
      ['Website', 'down'],
    ]);
    expect(body.monitors[0].uptime90).toBeCloseTo(expectedUptime90, 1);
    expect(body.monitors[1].uptime90).toBeNull();
    expect(body.monitors[0].days).toHaveLength(90);
    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0]).toMatchObject({
      monitorName: 'Website',
      resolvedAt: null,
      sample: false,
    });
    expect(body.includesSampleData).toBe(false);
    // Uptime is confirmed downtime over covered time: 864 s of 86,400 s.
    expect(body.monitors[0].days.at(-2).uptime).toBe(99);
    expect(body.monitors[0].days.at(-1).uptime).toBe(100);
  });

  it('flags sample data (seeded rollups and incidents) and nothing else leaks', async () => {
    await DailyRollup.create({
      monitorId: web._id,
      workspaceId: wid,
      date: addDays(utcDayStart(new Date()), -3),
      totalChecks: 10,
      upChecks: 10,
      coveredSec: 86_400,
      isSeed: true,
    });
    await Incident.create({
      monitorId: web._id,
      workspaceId: wid,
      startedAt: new Date(Date.now() - 3_600_000),
      resolvedAt: new Date(Date.now() - 3_000_000),
      durationSec: 600,
      cause: 'Connection refused to 10.0.3.7:5432',
      causeCode: 'ECONNREFUSED',
      isSeed: true,
      timeline: [{ type: 'opened', message: 'secret detail', code: 'ECONNREFUSED' }],
    });
    await createPage();
    const body = (await getPublic()).body.data;
    expect(body.includesSampleData).toBe(true);
    expect(body.incidents.map((i) => i.sample).sort()).toEqual([false, true]);

    // Whitelist: exactly these keys, at every level.
    expect(Object.keys(body).sort()).toEqual([
      'description',
      'generatedAt',
      'incidents',
      'includesSampleData',
      'monitors',
      'overall',
      'title',
    ]);
    for (const monitor of body.monitors) {
      expect(Object.keys(monitor).sort()).toEqual(['days', 'name', 'status', 'uptime90']);
      for (const day of monitor.days) {
        expect(Object.keys(day).sort()).toEqual(['date', 'downtimeSec', 'totalChecks', 'uptime']);
      }
    }
    for (const incident of body.incidents) {
      expect(Object.keys(incident).sort()).toEqual([
        'durationSec',
        'monitorName',
        'resolvedAt',
        'sample',
        'startedAt',
      ]);
    }
    const text = JSON.stringify(body);
    for (const secret of ['ECONNREFUSED', 'secret detail', 'causeCode', 'coveredSec', 'isSeed']) {
      expect(text).not.toContain(secret);
    }
  });

  it('uses legacy rollups without coveredSec (a full day when final)', async () => {
    const today = utcDayStart(new Date());
    await DailyRollup.create([
      {
        monitorId: web._id,
        workspaceId: wid,
        date: addDays(today, -2),
        totalChecks: 50,
        upChecks: 50,
        downtimeSec: 8640,
        isFinal: true,
      },
      // Not final and no coverage: skipped for uptime.
      { monitorId: web._id, workspaceId: wid, date: today, totalChecks: 5, upChecks: 0 },
    ]);
    await createPage();
    const web90 = (await getPublic()).body.data.monitors[1];
    expect(web90.uptime90).toBe(90);
    expect(web90.days.at(-1).uptime).toBeNull();
  });

  it('exposes no private data (URLs, ids, headers, error details)', async () => {
    await createPage();
    const text = JSON.stringify((await getPublic()).body);
    for (const secret of [
      'internal-api.corp.local',
      'www.example.com',
      'Bearer secret',
      '10.0.3.7',
      String(api._id),
      String(wid),
      'workspaceId',
      'monitorId',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('treats private and unknown pages the same (404)', async () => {
    await createPage({ isPublic: false });
    expect((await getPublic()).status).toBe(404);
    expect((await getPublic('nope')).status).toBe(404);
  });

  it('serves repeat requests from cache, and invalidates on update', async () => {
    const page = await createPage();
    expect((await getPublic()).headers['x-cache']).toBe('MISS');
    expect((await getPublic()).headers['x-cache']).toBe('HIT');

    await request(app)
      .patch(pages(`/${page.id}`))
      .set(owner.auth)
      .send({ title: 'Renamed' });
    const after = await getPublic();
    expect(after.headers['x-cache']).toBe('MISS');
    expect(after.body.data.title).toBe('Renamed');
  });

  it('making a page private takes effect immediately, despite the cache', async () => {
    const page = await createPage();
    await getPublic();
    await request(app)
      .patch(pages(`/${page.id}`))
      .set(owner.auth)
      .send({ isPublic: false });
    expect((await getPublic()).status).toBe(404);
  });
});

describe('createTtlCache', () => {
  it('expires entries and evicts the oldest when full', () => {
    let clock = 0;
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2, now: () => clock });
    cache.set('a', 1);
    cache.set('b', null);
    expect(cache.get('b')).toEqual({ hit: true, value: null });
    cache.set('c', 3); // evicts "a"
    expect(cache.get('a').hit).toBe(false);
    clock = 1001;
    expect(cache.get('c').hit).toBe(false);
  });
});
