import { mongoose } from '@pulseboard/shared/db';
import { CheckResult, DailyRollup, Monitor } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { addDays, utcDayStart } from '@pulseboard/shared/uptime';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp();

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

let owner, wid, monitor;
const url = (path) => `/api/v1/workspaces/${wid}/monitors${path}`;
const get = (path) => request(app).get(url(path)).set(owner.auth);

beforeEach(async () => {
  await clearMemoryDb();
  owner = await registerUser(app);
  wid = owner.workspaceId;
  monitor = await Monitor.create({
    workspaceId: wid,
    name: 'API',
    url: 'https://x.example',
    intervalSec: 30,
  });
});

/** Inserts `count` checks ending now, `stepSec` apart; `isOk(i)` decides each result. */
async function insertChecks(
  count,
  { stepSec = 10, isOk = () => true, monitorId = monitor._id } = {},
) {
  const now = Date.now();
  await CheckResult.insertMany(
    Array.from({ length: count }, (_, i) => ({
      timestamp: new Date(now - (count - i) * stepSec * 1000),
      meta: { monitorId, workspaceId: new mongoose.Types.ObjectId(wid) },
      ok: isOk(i),
      totalMs: 100 + i,
      statusCode: 200,
      timings: { dnsMs: 1, tcpMs: 2, tlsMs: 3, ttfbMs: 4, downloadMs: 5 },
    })),
  );
}

describe('GET /monitors/:mid/uptime', () => {
  it('computes 24h from raw checks and longer windows from rollups', async () => {
    await insertChecks(100, { isOk: (i) => i % 50 !== 0 }); // 2 failures out of 100
    const today = utcDayStart(new Date());
    await DailyRollup.create([
      { monitorId: monitor._id, workspaceId: wid, date: today, totalChecks: 100, upChecks: 98 },
      {
        monitorId: monitor._id,
        workspaceId: wid,
        date: addDays(today, -10),
        totalChecks: 100,
        upChecks: 50,
      },
      {
        monitorId: monitor._id,
        workspaceId: wid,
        date: addDays(today, -60),
        totalChecks: 100,
        upChecks: 0,
      },
    ]);

    const res = await get(`/${monitor._id}/uptime`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ h24: 98, d7: 98, d30: 74, d90: 49.333 });
  });

  it('returns null (not 100%) when there is no data yet', async () => {
    const res = await get(`/${monitor._id}/uptime`);
    expect(res.body.data).toEqual({ h24: null, d7: null, d30: null, d90: null });
  });

  it('404s for a monitor of another workspace', async () => {
    const other = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/workspaces/${other.workspaceId}/monitors/${monitor._id}/uptime`)
      .set(other.auth);
    expect(res.status).toBe(404);
  });
});

describe('GET /monitors/:mid/checks', () => {
  it('returns raw points (oldest first) when there are few', async () => {
    await insertChecks(20);
    const res = await get(`/${monitor._id}/checks`);
    expect(res.body.data.downsampled).toBe(false);
    expect(res.body.data.points).toHaveLength(20);
    expect(new Date(res.body.data.points[0].t) < new Date(res.body.data.points[19].t)).toBe(true);
    expect(res.body.data.points[0]).toMatchObject({
      ok: true,
      totalMs: 100,
      timings: { ttfbMs: 4 },
    });
  });

  it('downsamples to at most 500 points, keeping failures visible', async () => {
    // 1,500 checks over ~4 hours, one failure in the middle.
    await insertChecks(1500, { isOk: (i) => i !== 750 });
    const from = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const res = await get(`/${monitor._id}/checks?from=${from}`);

    const { points, downsampled, bucketSec } = res.body.data;
    expect(downsampled).toBe(true);
    expect(bucketSec).toBeGreaterThan(10);
    expect(points.length).toBeLessThanOrEqual(500);
    expect(points.reduce((sum, p) => sum + p.count, 0)).toBe(1500);
    expect(points.filter((p) => !p.ok)).toHaveLength(1);
  });

  it('returns the latest N checks with ?limit', async () => {
    await insertChecks(50);
    const res = await get(`/${monitor._id}/checks?limit=30`);
    expect(res.body.data.points).toHaveLength(30);
    expect(res.body.data.points.at(-1).totalMs).toBe(149); // newest last
  });

  it('rejects ranges over 7 days and inverted ranges', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect((await get(`/${monitor._id}/checks?from=${tenDaysAgo}`)).status).toBe(400);
    const now = new Date().toISOString();
    expect((await get(`/${monitor._id}/checks?from=${now}&to=${tenDaysAgo}`)).status).toBe(400);
  });
});

describe('GET /monitors/:mid/daily', () => {
  it('returns one entry per day, gaps filled with null uptime', async () => {
    const today = utcDayStart(new Date());
    await DailyRollup.create({
      monitorId: monitor._id,
      workspaceId: wid,
      date: addDays(today, -1),
      totalChecks: 200,
      upChecks: 199,
      downtimeSec: 30,
    });
    const res = await get(`/${monitor._id}/daily?days=90`);
    expect(res.body.data).toHaveLength(90);
    expect(res.body.data.at(-2)).toMatchObject({ uptime: 99.5, downtimeSec: 30 });
    expect(res.body.data.at(-1).uptime).toBeNull();
  });
});

describe('GET /monitors/sparklines', () => {
  it('returns recent response times for every monitor in one request', async () => {
    const second = await Monitor.create({
      workspaceId: wid,
      name: 'B',
      url: 'https://b.example',
      intervalSec: 30,
    });
    await insertChecks(40);
    await insertChecks(5, { monitorId: second._id });

    const res = await get('/sparklines?points=30');
    expect(res.status).toBe(200);
    expect(res.body.data[String(monitor._id)]).toHaveLength(30);
    expect(res.body.data[String(monitor._id)].at(-1)).toMatchObject({ ms: 139, ok: true });
    expect(res.body.data[String(second._id)]).toHaveLength(5);
  });
});
