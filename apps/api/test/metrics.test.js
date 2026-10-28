import { MISSED_PING_PREFIX } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { AgentReport, CheckResult, Incident, Monitor } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { truncateTo } from '@pulseboard/shared/uptime';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bucketGrid,
  changePercent,
  getMetrics,
  METRIC_RANGES,
  roundTo,
  summarizeSeries,
} from '../src/modules/monitors/metrics.service.js';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp();

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

const MIN = 60_000;
const BASE = Math.floor(Date.now() / (2 * 60 * MIN)) * 2 * 60 * MIN - 2 * 60 * MIN;
// Aligned to every bucket size, then 100 min 30 s in: the last bucket of each range contains it,
// and it is in the past (and recent enough that nothing expires).
const NOW = new Date(BASE + 100 * MIN + 30_000);

let owner, wid, monitor;
const url = (path) => `/api/v1/workspaces/${wid}/monitors${path}`;
const get = (path) => request(app).get(url(path)).set(owner.auth);
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);
const meta = (monitorId) => ({
  monitorId,
  workspaceId: new mongoose.Types.ObjectId(wid),
});
const metric = (data, key) => data.metrics.find((m) => m.key === key);
const nonNull = (m) => m.series.filter((p) => p.v != null);

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

function check(monitorId, timestamp, extra = {}) {
  return { timestamp, meta: meta(monitorId), ok: true, totalMs: 100, ...extra };
}

describe('pure helpers', () => {
  it('has the contract grid sizes', () => {
    expect(METRIC_RANGES['1h']).toMatchObject({ bucketMs: 60_000, count: 60 });
    expect(METRIC_RANGES['24h']).toMatchObject({ bucketMs: 900_000, count: 96 });
    expect(METRIC_RANGES['7d']).toMatchObject({ bucketMs: 7_200_000, count: 84 });
  });

  it('builds an aligned grid ending in the bucket that contains now', () => {
    for (const [range, { bucketMs, count }] of Object.entries(METRIC_RANGES)) {
      const grid = bucketGrid(range, NOW);
      expect(grid.starts).toHaveLength(count);
      expect(grid.starts[0]).toEqual(grid.from);
      const last = grid.starts[count - 1].getTime();
      expect(last % bucketMs).toBe(0);
      expect(last <= NOW.getTime() && NOW.getTime() < last + bucketMs).toBe(true);
      expect(grid.from.getTime()).toBe(last - (count - 1) * bucketMs);
      expect(grid.prevFrom.getTime()).toBe(grid.from.getTime() - count * bucketMs);
      for (let i = 1; i < count; i += 1) {
        expect(grid.starts[i] - grid.starts[i - 1]).toBe(bucketMs);
      }
    }
  });

  it('matches $dateTrunc bins for all three ranges', async () => {
    const odd = new Date(Date.UTC(2026, 2, 11, 13, 47, 29));
    for (const [range, spec] of Object.entries(METRIC_RANGES)) {
      const grid = bucketGrid(range, odd);
      // One check at the very start and one at the very end of every bucket.
      const docs = grid.starts.flatMap((start) => [
        check(monitor._id, start),
        check(monitor._id, new Date(start.getTime() + spec.bucketMs - 1)),
      ]);
      await CheckResult.insertMany(docs);
      const rows = await CheckResult.aggregate([
        { $match: { 'meta.monitorId': monitor._id } },
        {
          $group: {
            _id: { $dateTrunc: { date: '$timestamp', unit: spec.unit, binSize: spec.binSize } },
            n: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      expect(rows.map((r) => r._id.getTime())).toEqual(grid.starts.map((s) => s.getTime()));
      expect(rows.every((r) => r.n === 2)).toBe(true);
      await CheckResult.deleteMany({});
    }
  });

  it('rounds, computes change and summarises series', () => {
    expect(roundTo(1.005, 2)).toBeCloseTo(1, 1);
    expect(roundTo(null, 2)).toBeNull();
    expect(changePercent(110, 100)).toBe(10);
    expect(changePercent(90, -100)).toBe(190);
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(null, 4)).toBeNull();
    expect(summarizeSeries([null, 4, null, 8, 6])).toEqual({
      current: 6,
      peak: 8,
      average: 6,
      low: 4,
    });
    expect(summarizeSeries([null, null]).current).toBeNull();
  });
});

describe('GET /monitors/:mid/metrics (http)', () => {
  const grid = bucketGrid('24h', NOW);

  async function seed() {
    // Current window: 10 ok checks (100..190 ms) + 2 failures, over 3 buckets.
    await CheckResult.insertMany([
      ...Array.from({ length: 10 }, (_, i) =>
        check(monitor._id, at(-(i + 1) * MIN * 7), {
          totalMs: 100 + i * 10,
          timings: { dnsMs: 2, tcpMs: 4, tlsMs: 6, ttfbMs: 8, downloadMs: 10 },
        }),
      ),
      check(monitor._id, at(-3 * MIN), { ok: false, totalMs: null, statusCode: 500 }),
      check(monitor._id, at(-5 * MIN), { ok: false, totalMs: null, statusCode: 500 }),
      // Previous window: 4 ok checks at 100 ms.
      ...Array.from({ length: 4 }, (_, i) =>
        check(monitor._id, new Date(grid.from.getTime() - (i + 1) * 60 * MIN)),
      ),
      // Another monitor must not leak in.
      check(new mongoose.Types.ObjectId(), at(-MIN)),
    ]);
  }

  it('computes uptime, failed, avg, p95 and change vs the previous window', async () => {
    await seed();
    // Uptime comes from incidents only: 10 minutes of confirmed downtime in the current window.
    await Incident.create({
      monitorId: monitor._id,
      workspaceId: wid,
      startedAt: at(-30 * MIN),
      resolvedAt: at(-20 * MIN),
    });
    const data = await getMetrics(monitor._id, '24h', NOW);
    expect(data).toMatchObject({ type: 'http', range: '24h', bucketMs: 900_000, empty: false });
    expect(data.from).toBe(grid.from.toISOString());
    expect(data.to).toBe(NOW.toISOString());
    expect(data.metrics.map((m) => m.key)).toEqual(['uptime', 'p95', 'failed', 'avgResponse']);
    for (const m of data.metrics) expect(m.series).toHaveLength(96);

    const uptime = metric(data, 'uptime');
    // The card covers exactly the selected range (24 h) ending now: 10 min of 24 h, cut to 2 decimals.
    const expected = truncateTo((1 - 600 / 86_400) * 100, 2);
    expect(uptime).toMatchObject({ label: 'Uptime', unit: '%', value: expected, previous: 100 });
    // The change is in percentage points between the figures as shown: 99.30 - 100.
    expect(uptime.change).toBe(Number((expected - 100).toFixed(2)));
    expect(metric(data, 'failed')).toMatchObject({ value: 16.67, previous: 0, change: null });
    const avg = metric(data, 'avgResponse');
    expect(avg).toMatchObject({ value: 145, previous: 100, change: 45 });
    const p95 = metric(data, 'p95');
    expect(p95.value).toBeGreaterThanOrEqual(180);
    expect(p95.value).toBeLessThanOrEqual(190);
    expect(p95.previous).toBe(100);
  });

  it('puts gaps as null and keeps current/peak/low/average over buckets with data', async () => {
    await seed();
    const data = await getMetrics(monitor._id, '24h', NOW);
    const uptime = metric(data, 'failed');
    const present = nonNull(uptime);
    expect(present.length).toBeGreaterThan(0);
    expect(present.length).toBeLessThan(96);
    expect(uptime.series.filter((p) => p.v == null).length).toBe(96 - present.length);
    const values = present.map((p) => p.v);
    expect(uptime.peak).toBe(Math.max(...values));
    expect(uptime.low).toBe(Math.min(...values));
    expect(uptime.current).toBe(values[values.length - 1]);
    // Last bucket: the ok check at -7 min and the two failures.
    expect(uptime.series[95].v).toBe(66.67);
    expect(uptime.series.map((p) => p.t)[0]).toBe(grid.from.toISOString());
  });

  it('has a timings array for http only, averaged over ok checks', async () => {
    await seed();
    const data = await getMetrics(monitor._id, '24h', NOW);
    expect(data.timings).toHaveLength(96);
    const filled = data.timings.filter((t) => t.dnsMs != null);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled[0]).toMatchObject({ dnsMs: 2, tcpMs: 4, tlsMs: 6, ttfbMs: 8, downloadMs: 10 });
    const empty = data.timings.find((t) => t.dnsMs == null);
    expect(empty).toMatchObject({ dnsMs: null, tcpMs: null, tlsMs: null });
  });

  it('returns live accumulators for the last bucket and the window', async () => {
    await seed();
    await CheckResult.insertMany([
      check(monitor._id, at(-10_000), { totalMs: 50 }),
      check(monitor._id, at(-5_000), { totalMs: 70 }),
    ]);
    const { live } = await getMetrics(monitor._id, '24h', NOW);
    expect(live.lastAt).toBe(at(-5_000).toISOString());
    expect(live.range).toEqual({ n: 14, ok: 12, sumMs: 1450 + 120, nMs: 12 });
    expect(live.last.t).toBe(grid.starts[95].toISOString());
    // Last 24h bucket holds the ok check at -7 min, the failures at -3/-5 min and the two new ones.
    expect(live.last).toMatchObject({ n: 5, ok: 3, sumMs: 220, nMs: 3 });
  });

  it('reports empty:true with an all-null grid when the monitor has no data', async () => {
    const data = await getMetrics(monitor._id, '1h', NOW);
    expect(data.empty).toBe(true);
    for (const m of data.metrics) {
      expect(m).toMatchObject({ value: null, previous: null, change: null, current: null });
      expect(m.series).toHaveLength(60);
      expect(nonNull(m)).toHaveLength(0);
    }
    expect(data.live).toMatchObject({ lastAt: null });
    expect(data.live.range).toEqual({ n: 0, ok: 0, sumMs: 0, nMs: 0 });
  });

  it('is not empty when only the previous window has data; value comes from watched time', async () => {
    const g = bucketGrid('1h', NOW);
    await CheckResult.insertMany([check(monitor._id, new Date(g.from.getTime() - 5 * MIN))]);
    const data = await getMetrics(monitor._id, '1h', NOW);
    expect(data.empty).toBe(false);
    const uptime = metric(data, 'uptime');
    // We were watching all along and no incident opened: 100% in both windows.
    expect(uptime).toMatchObject({ value: 100, previous: 100, change: 0 });
    expect(metric(data, 'failed')).toMatchObject({ value: null, previous: 0 });
  });

  it('serves all three ranges with 60, 96 and 84 buckets', async () => {
    await seed();
    for (const [range, { count }] of Object.entries(METRIC_RANGES)) {
      const data = await getMetrics(monitor._id, range, NOW);
      expect(data.range).toBe(range);
      expect(metric(data, 'uptime').series).toHaveLength(count);
      expect(data.timings).toHaveLength(count);
    }
  });

  it('stays fast and bounded with a few thousand checks', async () => {
    const docs = Array.from({ length: 5000 }, (_, i) =>
      check(monitor._id, at(-(i % 1400) * 1000 - 1000), {
        ok: i % 10 !== 0,
        totalMs: 80 + (i % 40),
      }),
    );
    docs.push(...Array.from({ length: 500 }, () => check(new mongoose.Types.ObjectId(), at(-MIN))));
    await CheckResult.insertMany(docs);
    const started = Date.now();
    const data = await getMetrics(monitor._id, '24h', NOW);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(data.live.range.n).toBe(5000);
    // 10% of the checks failed but no incident opened: uptime is unchanged.
    expect(metric(data, 'failed').value).toBe(10);
    expect(metric(data, 'uptime').value).toBe(100);
  });
});

describe('GET /monitors/:mid/metrics (heartbeat)', () => {
  let hb;
  const g = bucketGrid('1h', NOW);
  const missedError = `${MISSED_PING_PREFIX} 1m + 10s grace`;

  beforeEach(async () => {
    hb = await Monitor.create({
      workspaceId: wid,
      name: 'Cron',
      type: 'heartbeat',
      expectedEverySec: 60,
      graceSec: 10,
    });
  });

  const ping = (ts, extra = {}) =>
    check(hb._id, ts, { source: 'heartbeat', totalMs: null, ...extra });
  const P0 = new Date(g.prevFrom.getTime() - 5 * MIN); // predecessor of the previous window
  const P1 = new Date(g.prevFrom.getTime() + 2 * MIN);

  async function seed() {
    await CheckResult.insertMany([
      ping(P0),
      ping(P1),
      ping(new Date(g.prevFrom.getTime() + 30 * MIN), { ok: false, error: missedError }),
      ping(at(-10 * MIN)),
      ping(at(-9 * MIN), { totalMs: 2000 }),
      ping(at(-7 * MIN)),
      ping(at(-4 * MIN), { ok: false, error: 'job failed', totalMs: 4000 }),
      ping(at(-3 * MIN), { ok: false, error: missedError }),
    ]);
  }

  it('counts missed pings by the overdue message and computes uptime', async () => {
    await seed();
    const data = await getMetrics(hb._id, '1h', NOW);
    expect(data).toMatchObject({ type: 'heartbeat', empty: false, timings: null });
    expect(data.metrics.map((m) => m.key)).toEqual(['uptime', 'missed', 'lateness', 'duration']);
    // Missed pings are not downtime until an incident opens.
    expect(metric(data, 'uptime')).toMatchObject({ value: 100 });
    const missed = metric(data, 'missed');
    expect(missed).toMatchObject({ unit: 'pings', value: 1, previous: 1, change: 0 });
    // A failed ping that is not a missed record is not counted as missed.
    expect(nonNull(missed).reduce((sum, p) => sum + p.v, 0)).toBe(1 + 0 + 0 + 0 + 0);
    expect(nonNull(missed).length).toBeLessThan(60);
  });

  it('computes lateness against the previous ping, including one before the window', async () => {
    await seed();
    const data = await getMetrics(hb._id, '1h', NOW);
    const lateness = metric(data, 'lateness');
    const expected = 60_000;
    const first = Math.max(0, at(-10 * MIN) - P1 - expected);
    const current = (first + 0 + 60_000 + 120_000) / 4;
    expect(lateness.value).toBe(Math.round(current));
    // Previous window: P1 (gap 7 min from P0, expected 1 min) is the only ping with a predecessor.
    expect(lateness.previous).toBe(360_000);
  });

  it('averages the duration of pings that carry one', async () => {
    await seed();
    const data = await getMetrics(hb._id, '1h', NOW);
    expect(metric(data, 'duration')).toMatchObject({ value: 3000, previous: null, change: null });
  });

  it('first ping of a monitor has no lateness (no predecessor)', async () => {
    await CheckResult.insertMany([ping(at(-10 * MIN))]);
    const data = await getMetrics(hb._id, '1h', NOW);
    expect(metric(data, 'lateness').value).toBeNull();
    expect(metric(data, 'missed').value).toBe(0);
  });
});

describe('GET /monitors/:mid/metrics (agent)', () => {
  let agent;

  beforeEach(async () => {
    agent = await Monitor.create({
      workspaceId: wid,
      name: 'Agent',
      type: 'agent',
      reportEverySec: 60,
    });
  });

  const report = (monitorId, ts, extra) => ({
    windowStart: new Date(ts.getTime() - 60_000),
    windowEnd: ts,
    meta: meta(monitorId),
    requests: 0,
    errors5xx: 0,
    errors4xx: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    ...extra,
  });

  it('computes request rate, weighted p95, error rate and uptime from checks', async () => {
    await AgentReport.insertMany([
      report(agent._id, at(-5 * MIN), { requests: 600, errors5xx: 6, p95Ms: 100 }),
      report(agent._id, at(-4 * MIN), { requests: 200, p95Ms: 200 }),
      report(agent._id, at(-3 * MIN), { requests: 0 }),
    ]);
    await CheckResult.insertMany([
      check(agent._id, at(-5 * MIN), { source: 'agent' }),
      check(agent._id, at(-4 * MIN), { source: 'agent' }),
      check(agent._id, at(-3 * MIN), { source: 'agent' }),
      check(agent._id, at(-2 * MIN), { source: 'probe', ok: false, totalMs: null }),
    ]);
    const data = await getMetrics(agent._id, '1h', NOW);
    expect(data.type).toBe('agent');
    expect(data.timings).toBeNull();
    expect(data.metrics.map((m) => m.key)).toEqual([
      'requestRate',
      'p95Latency',
      'errorRate',
      'uptime',
    ]);
    const windowSec = (NOW - bucketGrid('1h', NOW).from) / 1000;
    const rate = metric(data, 'requestRate');
    expect(rate.unit).toBe('req/s');
    expect(rate.value).toBe(Math.round((800 / windowSec) * 100) / 100);
    expect(rate.peak).toBe(10); // 600 requests in a 60 s bucket
    expect(rate.low).toBe(0);
    expect(metric(data, 'p95Latency').value).toBe(125);
    expect(metric(data, 'p95Latency').series.some((p) => p.v === 100)).toBe(true);
    expect(metric(data, 'errorRate').value).toBe(0.75);
    expect(metric(data, 'uptime').value).toBe(100);
    expect(data.empty).toBe(false);
  });

  it('error rate and p95 are null when there were no requests', async () => {
    await AgentReport.insertMany([report(agent._id, at(-5 * MIN), { requests: 0 })]);
    const data = await getMetrics(agent._id, '1h', NOW);
    expect(metric(data, 'errorRate').value).toBeNull();
    expect(metric(data, 'p95Latency').value).toBeNull();
    expect(metric(data, 'requestRate').value).toBe(0);
    // No checks stored and the monitor is newer than the window: nothing was watched.
    expect(metric(data, 'uptime').value).toBeNull();
    expect(data.empty).toBe(false);
  });

  it('is empty without reports and checks', async () => {
    const data = await getMetrics(agent._id, '24h', NOW);
    expect(data.empty).toBe(true);
    expect(metric(data, 'requestRate').series).toHaveLength(96);
  });
});

describe('metrics route', () => {
  it('serves the default range (24h) over HTTP', async () => {
    await CheckResult.insertMany([check(monitor._id, new Date(Date.now() - 2 * MIN))]);
    const res = await get(`/${monitor._id}/metrics`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: 'http', range: '24h', bucketMs: 900_000 });
    expect(res.body.data.metrics[0].series).toHaveLength(96);
    const week = await get(`/${monitor._id}/metrics?range=7d`);
    expect(week.body.data.metrics[0].series).toHaveLength(84);
    const hour = await get(`/${monitor._id}/metrics?range=1h`);
    expect(hour.body.data.metrics[0].series).toHaveLength(60);
  });

  it('400s for an unknown range', async () => {
    const res = await get(`/${monitor._id}/metrics?range=30d`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s for a monitor of another workspace and for a malformed id', async () => {
    const other = await Monitor.create({
      workspaceId: new mongoose.Types.ObjectId(),
      name: 'Other',
      url: 'https://y.example',
      intervalSec: 30,
    });
    expect((await get(`/${other._id}/metrics`)).status).toBe(404);
    expect((await get('/not-an-id/metrics')).status).toBe(404);
  });

  it('requires authentication and workspace membership', async () => {
    const anon = await request(app).get(url(`/${monitor._id}/metrics`));
    expect(anon.status).toBe(401);
    const stranger = await registerUser(app);
    const res = await request(app)
      .get(url(`/${monitor._id}/metrics`))
      .set(stranger.auth);
    expect(res.status).toBe(404);
  });
});

describe('agent p95 latency precision', () => {
  it('keeps one decimal for sub-millisecond latencies', async () => {
    const agent = await Monitor.create({
      workspaceId: wid,
      name: 'Agent',
      type: 'agent',
      reportEverySec: 60,
    });
    await AgentReport.insertMany(
      [0.4, 0.4, 0.8].map((p95Ms, i) => ({
        windowStart: at(-(i + 2) * MIN),
        windowEnd: at(-(i + 1) * MIN),
        meta: meta(agent._id),
        requests: 30,
        errors5xx: 0,
        errors4xx: 0,
        p95Ms,
      })),
    );
    const m = metric(await getMetrics(agent._id, '1h', NOW), 'p95Latency');
    expect(m.value).toBe(0.5);
    expect(m.peak).toBe(0.8);
    expect(m.low).toBe(0.4);
  });
});

describe('GET /monitors/:mid/metrics (unknown results, failures, sample data)', () => {
  const grid = bucketGrid('24h', NOW);
  const unknown = (ts, extra = {}) =>
    check(monitor._id, ts, {
      ok: false,
      state: 'unknown',
      unknownReason: 'checker_offline',
      totalMs: null,
      errorCode: 'ENOTFOUND',
      error: 'getaddrinfo ENOTFOUND',
      ...extra,
    });
  const bucketStart = (ts) =>
    new Date(Math.floor(ts.getTime() / grid.bucketMs) * grid.bucketMs).toISOString();

  it('excludes unknown results from failed, uptime counts and the live accumulators', async () => {
    await CheckResult.insertMany([
      check(monitor._id, at(-4 * MIN), { state: 'ok' }),
      check(monitor._id, at(-5 * MIN), { state: 'ok' }),
      check(monitor._id, at(-6 * MIN), { state: 'ok' }),
      check(monitor._id, at(-7 * MIN), { ok: false, state: 'failed', totalMs: null }),
      unknown(at(-3 * MIN)),
      unknown(at(-2 * MIN)),
    ]);
    const data = await getMetrics(monitor._id, '24h', NOW);
    expect(metric(data, 'failed').value).toBe(25); // 1 of 4, not 3 of 6
    expect(data.live.range).toMatchObject({ n: 4, ok: 3 });
    expect(data.live.last).toMatchObject({ n: 4, ok: 3 });
    expect(metric(data, 'uptime').value).toBe(100);
    expect(data.empty).toBe(false);
  });

  it('marks buckets of only unknown results offline (value null) on every metric and timings', async () => {
    const offlineAt = at(-60 * MIN);
    await CheckResult.insertMany([
      check(monitor._id, at(-3 * MIN), { timings: { dnsMs: 2, tcpMs: 4, tlsMs: 6 } }),
      unknown(offlineAt),
      unknown(new Date(offlineAt.getTime() + 20_000)),
    ]);
    const data = await getMetrics(monitor._id, '24h', NOW);
    const t = bucketStart(offlineAt);
    for (const key of ['uptime', 'p95', 'failed', 'avgResponse']) {
      const point = metric(data, key).series.find((p) => p.t === t);
      expect(point).toEqual({ t, v: null, offline: true });
      // Buckets that were not offline never carry the flag.
      expect(metric(data, key).series.filter((p) => p.offline)).toHaveLength(1);
    }
    expect(data.timings.find((x) => x.t === t)).toMatchObject({ offline: true, dnsMs: null });
    expect(data.timings.filter((x) => x.offline)).toHaveLength(1);
    // The window's figures ignore the offline gap.
    expect(metric(data, 'failed').value).toBe(0);
  });

  it('lists the 20 newest failures with code and message, never unknown ones', async () => {
    await CheckResult.insertMany([
      ...Array.from({ length: 25 }, (_, i) =>
        check(monitor._id, at(-(i + 1) * MIN), {
          ok: false,
          state: 'failed',
          totalMs: null,
          errorCode: `HTTP_5${String(i).padStart(2, '0')}`,
          error: `Unexpected status ${i}`,
        }),
      ),
      unknown(at(-30_000)),
      check(monitor._id, at(-90_000)),
    ]);
    const { failures } = await getMetrics(monitor._id, '24h', NOW);
    expect(failures).toHaveLength(20);
    expect(failures[0]).toEqual({
      t: at(-MIN).toISOString(),
      code: 'HTTP_500',
      message: 'Unexpected status 0',
    });
    expect(failures[19].code).toBe('HTTP_519');
    const times = failures.map((f) => new Date(f.t).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(failures.some((f) => f.code === 'ENOTFOUND')).toBe(false);
  });

  it('has an empty failures list and includesSampleData false without any', async () => {
    await CheckResult.insertMany([check(monitor._id, at(-MIN))]);
    const data = await getMetrics(monitor._id, '24h', NOW);
    expect(data).toMatchObject({ failures: [], includesSampleData: false });
  });

  it('flags includesSampleData for seeded checks and for seeded incidents', async () => {
    await CheckResult.insertMany([check(monitor._id, at(-MIN), { isSeed: true })]);
    expect((await getMetrics(monitor._id, '24h', NOW)).includesSampleData).toBe(true);

    await CheckResult.deleteMany({});
    await CheckResult.insertMany([check(monitor._id, at(-MIN))]);
    await Incident.create({
      monitorId: monitor._id,
      workspaceId: wid,
      startedAt: at(-30 * MIN),
      resolvedAt: at(-20 * MIN),
      isSeed: true,
    });
    expect((await getMetrics(monitor._id, '24h', NOW)).includesSampleData).toBe(true);
  });

  it('counts an open incident as downtime up to now, in the bucket it falls in', async () => {
    await CheckResult.insertMany([check(monitor._id, at(-50 * MIN))]);
    await Incident.create({ monitorId: monitor._id, workspaceId: wid, startedAt: at(-10 * MIN) });
    const data = await getMetrics(monitor._id, '1h', NOW);
    const uptime = metric(data, 'uptime');
    // The last one-minute bucket is 30 s old: all of it is downtime.
    expect(uptime.series[59].v).toBe(0);
    expect(uptime.series[50].v).toBe(0);
    expect(uptime.series[49].v).toBe(50); // the incident opened 30 s into this minute
    expect(uptime.series[48].v).toBe(100);
    // Watched for 50 minutes, 10 of them down.
    expect(uptime.value).toBe(80);
  });

  it('serves the new fields over HTTP', async () => {
    await CheckResult.insertMany([
      check(monitor._id, new Date(Date.now() - 2 * MIN), { ok: false, errorCode: 'ETIMEDOUT' }),
    ]);
    const res = await get(`/${monitor._id}/metrics`);
    expect(res.body.data.failures).toHaveLength(1);
    expect(res.body.data.failures[0].code).toBe('ETIMEDOUT');
    expect(res.body.data.includesSampleData).toBe(false);
  });
});
