import { mongoose } from '@pulseboard/shared/db';
import { CheckResult, DailyRollup, Incident, Monitor } from '@pulseboard/shared/models';
import { closePause, openPause } from '@pulseboard/shared/pauses';
import { rebuildAllRollups } from '@pulseboard/shared/rollup';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { addDays, formatUptime, truncateTo, utcDayStart } from '@pulseboard/shared/uptime';
import { computeUptime } from '@pulseboard/shared/uptime/compute';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDailySeries, getUptime } from '../src/modules/monitors/analytics.service.js';
import { getMetrics } from '../src/modules/monitors/metrics.service.js';
import { buildTestApp, registerUser } from './helpers.js';

const app = buildTestApp();

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let owner, wid, monitor;
const workspaceObjectId = () => new mongoose.Types.ObjectId(wid);

beforeEach(async () => {
  await clearMemoryDb();
  owner = await registerUser(app);
  wid = owner.workspaceId;
  monitor = await Monitor.create({
    workspaceId: wid,
    name: 'API',
    url: 'https://x.example',
    intervalSec: 60,
  });
});

const check = (ageMs, extra = {}) => ({
  timestamp: new Date(Date.now() - ageMs),
  meta: { monitorId: monitor._id, workspaceId: workspaceObjectId() },
  ok: true,
  totalMs: 100,
  statusCode: 200,
  ...extra,
});

const incident = (startAgoMs, durationMs, extra = {}) =>
  Incident.create({
    monitorId: monitor._id,
    workspaceId: wid,
    startedAt: new Date(Date.now() - startAgoMs),
    ...(durationMs != null && { resolvedAt: new Date(Date.now() - startAgoMs + durationMs) }),
    cause: 'down',
    ...extra,
  });

const metricOf = (data, key) => data.metrics.find((m) => m.key === key);

describe('one uptime formula', () => {
  it('a failed check without an incident gives 100% everywhere', async () => {
    await CheckResult.insertMany([
      check(2 * DAY),
      check(HOUR, { ok: false, state: 'failed', errorCode: 'HTTP_503', statusCode: 503 }),
      check(30 * MIN, { ok: false, state: 'failed', errorCode: 'ETIMEDOUT' }),
    ]);
    const now = new Date();
    expect((await computeUptime(monitor._id, new Date(+now - DAY), now)).uptime).toBe(100);
    const summary = await getUptime(monitor._id, now);
    expect([summary.h24, summary.d7]).toEqual([100, 100]);
    const metrics = await getMetrics(monitor._id, '24h', now);
    const uptime = metricOf(metrics, 'uptime');
    expect(uptime.value).toBe(100);
    // The dips are only in "Failed checks": no uptime bucket falls below 100.
    expect(uptime.series.filter((p) => p.v != null).every((p) => p.v === 100)).toBe(true);
    expect(metricOf(metrics, 'failed').value).toBeGreaterThan(0);
  });

  it('a 15-minute incident in a 24h range gives 98.95%', async () => {
    await CheckResult.insertMany([check(3 * DAY)]);
    await incident(5 * HOUR, 15 * MIN);
    const now = new Date();
    const { uptime, downtimeSec, coveredSec } = await computeUptime(
      monitor._id,
      new Date(+now - DAY),
      now,
    );
    expect([downtimeSec, coveredSec]).toEqual([900, 86_400]);
    expect(formatUptime(uptime)).toBe('98.95');
    const metrics = await getMetrics(monitor._id, '24h', now);
    expect(metricOf(metrics, 'uptime').value).toBe(98.95);
  });

  it('never prints 100% when there was downtime, however small', async () => {
    await CheckResult.insertMany([check(3 * DAY)]);
    await incident(2 * HOUR, 1000); // one second
    const now = new Date();
    const summary = await getUptime(monitor._id, now);
    for (const value of [summary.h24, summary.d7, summary.d30, summary.d90]) {
      expect(value).toBeLessThan(100);
      expect(formatUptime(value)).not.toBe('100');
    }
    const metrics = await getMetrics(monitor._id, '7d', now);
    expect(metricOf(metrics, 'uptime').value).toBeLessThan(100);
  });

  it('the tiles, the card and the metrics endpoint return identical values for the same range', async () => {
    await CheckResult.insertMany([check(10 * DAY), check(HOUR, { ok: false, state: 'failed' })]);
    await incident(30 * HOUR, HOUR);
    await incident(5 * HOUR, 7 * MIN);
    const now = new Date();

    const summary = await getUptime(monitor._id, now);
    const day = await getMetrics(monitor._id, '24h', now);
    const week = await getMetrics(monitor._id, '7d', now);
    expect(metricOf(day, 'uptime').value).toBe(truncateTo(summary.h24, 2));
    expect(metricOf(week, 'uptime').value).toBe(truncateTo(summary.d7, 2));
    expect(formatUptime(summary.h24)).toBe(formatUptime(metricOf(day, 'uptime').value));

    // And through HTTP: the same endpoints the page calls.
    const base = `/api/v1/workspaces/${wid}/monitors/${monitor._id}`;
    const http = await request(app).get(`${base}/uptime`).set(owner.auth);
    const httpMetrics = await request(app).get(`${base}/metrics?range=24h`).set(owner.auth);
    expect(formatUptime(http.body.data.h24)).toBe(
      formatUptime(metricOf(httpMetrics.body.data, 'uptime').value),
    );
  });

  it('sparkline buckets are incident downtime over bucket length, and gaps where nothing was watched', async () => {
    await CheckResult.insertMany([check(3 * HOUR)]);
    await incident(2 * HOUR, 5 * MIN);
    const metrics = await getMetrics(monitor._id, '24h', new Date());
    const series = metricOf(metrics, 'uptime').series;
    const dips = series.filter((p) => p.v != null && p.v < 100);
    // The 5 minutes may straddle a bucket edge: the downtime is split, never lost or invented.
    expect(dips.length).toBeGreaterThanOrEqual(1);
    expect(dips.length).toBeLessThanOrEqual(2);
    const lostMinutes = dips.reduce((sum, p) => sum + ((100 - p.v) / 100) * 15, 0);
    expect(lostMinutes).toBeGreaterThan(4.9);
    expect(lostMinutes).toBeLessThanOrEqual(5.1);
    // Before the first result there is nothing to measure: gaps, not 100% and not 0%.
    expect(series[0].v).toBeNull();
  });

  it('paused time counts as neither up nor down', async () => {
    await CheckResult.insertMany([check(2 * DAY)]);
    const now = new Date();
    await openPause(monitor._id, new Date(+now - 12 * HOUR));
    await closePause(monitor._id, new Date(+now - 6 * HOUR));
    const { coveredSec, downtimeSec, uptime } = await computeUptime(
      monitor._id,
      new Date(+now - DAY),
      now,
    );
    expect(coveredSec).toBe(18 * 3600);
    expect(downtimeSec).toBe(0);
    expect(uptime).toBe(100);
    const stored = await Monitor.findById(monitor._id).lean();
    expect(stored.pauses).toHaveLength(1);
    expect(stored.pauses[0].to).toBeTruthy();
  });

  it('time the checker was offline counts as neither up nor down', async () => {
    const now = new Date();
    await CheckResult.insertMany([
      check(2 * DAY),
      check(3 * HOUR, { ok: false, state: 'unknown', errorCode: 'ETIMEDOUT' }),
      check(2 * HOUR, { ok: false, state: 'unknown', errorCode: 'ETIMEDOUT' }),
    ]);
    const { coveredSec } = await computeUptime(monitor._id, new Date(+now - DAY), now);
    // Two unknown results, each standing for one 60 s check interval.
    expect(coveredSec).toBe(86_400 - 120);
  });

  it('openPause is idempotent and closePause only closes an open pause', async () => {
    await openPause(monitor._id, new Date(Date.now() - HOUR));
    await openPause(monitor._id, new Date());
    await closePause(monitor._id, new Date());
    await closePause(monitor._id, new Date());
    expect((await Monitor.findById(monitor._id).lean()).pauses).toHaveLength(1);
  });

  it('the daily bar for today uses the live figure, not the 15-minute-old rollup', async () => {
    await CheckResult.insertMany([check(2 * DAY)]);
    const today = utcDayStart(new Date());
    await DailyRollup.create({
      monitorId: monitor._id,
      workspaceId: wid,
      date: today,
      totalChecks: 1,
      upChecks: 1,
      downtimeSec: 0,
      coveredSec: 10,
    });
    await incident(Math.min(20 * MIN, Date.now() - +today - 1000), null);
    const series = await getDailySeries(monitor._id, 3, new Date());
    expect(series.at(-1).uptime).toBeLessThan(100);
  });
});

describe('rebuilding rollups', () => {
  it('recomputes downtime and watched time with the current formula, and leaves sample rows alone', async () => {
    await CheckResult.insertMany([check(5 * DAY)]);
    const today = utcDayStart(new Date());
    const day = addDays(today, -2);
    await DailyRollup.create([
      {
        monitorId: monitor._id,
        workspaceId: wid,
        date: day,
        totalChecks: 10,
        upChecks: 6, // a pass rate of 60%: must not leak into uptime
        downtimeSec: 99_999, // stale, from an older formula
        coveredSec: 50_000,
        isFinal: true,
      },
      {
        monitorId: new mongoose.Types.ObjectId(),
        workspaceId: wid,
        date: day,
        totalChecks: 10,
        upChecks: 10,
        downtimeSec: 123,
        coveredSec: 456,
        isFinal: true,
        isSeed: true,
      },
    ]);
    await Incident.create({
      monitorId: monitor._id,
      workspaceId: wid,
      startedAt: new Date(+day + 10 * HOUR),
      resolvedAt: new Date(+day + 10 * HOUR + 15 * MIN),
      cause: 'down',
    });

    const result = await rebuildAllRollups();
    expect(result.days).toBeGreaterThanOrEqual(1);

    const rebuilt = await DailyRollup.findOne({ monitorId: monitor._id, date: day }).lean();
    expect(rebuilt.downtimeSec).toBe(900);
    expect(rebuilt.coveredSec).toBe(86_400); // watched since 5 days ago: the whole day
    expect(rebuilt).toMatchObject({ totalChecks: 10, upChecks: 6 });
    const sample = await DailyRollup.findOne({ isSeed: true }).lean();
    expect(sample).toMatchObject({ downtimeSec: 123, coveredSec: 456 });
  });
});
