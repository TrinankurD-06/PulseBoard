import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAlert, buildNotice } from '../src/alerts/index.js';
import { liftBudgetRestriction } from '../src/budget/index.js';
import { Monitor, MonitorUsage } from '../src/models/index.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';
import { claimUsageMarker, clearUsageMarkers, recordUsage } from '../src/usage/index.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
const createMonitor = (overrides = {}) =>
  Monitor.create({
    workspaceId,
    name: 'API',
    url: 'https://x.example',
    intervalSec: 60,
    ...overrides,
  });

function recordingScheduler() {
  const calls = [];
  return {
    calls,
    scheduleMonitor: async (monitor) =>
      calls.push(['schedule', String(monitor._id), monitor.currentIntervalSec]),
    cancelMonitor: async (id) => calls.push(['cancel', String(id)]),
  };
}

describe('usage markers', () => {
  it('recordUsage returns the new monthly total', async () => {
    const monitor = await createMonitor();
    expect(await recordUsage(monitor, 2)).toBe(2);
    expect(await recordUsage(monitor, 3)).toBe(5);
    expect(await recordUsage(monitor, 0)).toBe(5);
  });

  it('claimUsageMarker succeeds exactly once, even when racing', async () => {
    const monitor = await createMonitor();
    await recordUsage(monitor, 1, new Date('2026-10-02T00:00:00Z'));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimUsageMarker(monitor._id, '2026-10', 'warnedAt')),
    );
    expect(results.filter(Boolean)).toHaveLength(1);

    await clearUsageMarkers(monitor._id, '2026-10', ['warnedAt']);
    expect(await claimUsageMarker(monitor._id, '2026-10', 'warnedAt')).toBe(true);
    expect((await MonitorUsage.findOne().lean()).warnedAt).toBeInstanceOf(Date);
  });
});

describe('liftBudgetRestriction', () => {
  it('resumes a monitor paused by budget, with counters reset and the base interval', async () => {
    const scheduler = recordingScheduler();
    const monitor = await createMonitor({
      isPaused: true,
      status: 'paused',
      pausedReason: 'budget_exceeded',
      budgetExceededMonth: '2026-09',
      consecutiveFailures: 4,
      currentIntervalSec: 900,
    });

    expect(await liftBudgetRestriction(monitor._id, scheduler)).toBe(true);
    const after = await Monitor.findById(monitor._id).lean();
    expect(after).toMatchObject({
      isPaused: false,
      status: 'pending',
      pausedReason: null,
      budgetExceededMonth: null,
      consecutiveFailures: 0,
      currentIntervalSec: 60,
    });
    expect(scheduler.calls).toEqual([['schedule', String(monitor._id), 60]]);
  });

  it('restores the base interval of a slowed monitor', async () => {
    const scheduler = recordingScheduler();
    const monitor = await createMonitor({
      budgetExceededMonth: '2026-09',
      currentIntervalSec: 900,
    });
    await liftBudgetRestriction(monitor._id, scheduler);
    expect((await Monitor.findById(monitor._id).lean()).currentIntervalSec).toBe(60);
    expect(scheduler.calls).toHaveLength(1);
  });

  it('keeps a user-paused monitor paused (only clears the budget marker)', async () => {
    const scheduler = recordingScheduler();
    const monitor = await createMonitor({
      isPaused: true,
      status: 'paused',
      pausedReason: 'user',
      budgetExceededMonth: '2026-09',
    });
    await liftBudgetRestriction(monitor._id, scheduler);
    expect(await Monitor.findById(monitor._id).lean()).toMatchObject({
      isPaused: true,
      pausedReason: 'user',
      budgetExceededMonth: null,
    });
    expect(scheduler.calls).toEqual([]);
  });

  it('does nothing without a restriction, and lifts only once when racing', async () => {
    const scheduler = recordingScheduler();
    const free = await createMonitor();
    expect(await liftBudgetRestriction(free._id, scheduler)).toBe(false);

    const slowed = await createMonitor({ budgetExceededMonth: '2026-09', currentIntervalSec: 900 });
    const results = await Promise.all([
      liftBudgetRestriction(slowed._id, scheduler),
      liftBudgetRestriction(slowed._id, scheduler),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('buildNotice', () => {
  const monitor = { _id: 'm1', workspaceId: 'w1', name: 'API', url: 'https://x.example' };
  const dashboardUrl = 'https://app.example/';

  it('describes an 80% warning and what will happen at 100%', () => {
    const notice = buildNotice({
      noticeKind: 'budget_warning',
      monitor,
      dashboardUrl,
      details: {
        requests: 16000,
        budget: 20000,
        month: '2026-10',
        budgetAction: 'slow',
        slowIntervalSec: 900,
      },
    });
    expect(notice).toMatchObject({
      kind: 'notice',
      link: 'https://app.example/app/w1/monitors/m1',
    });
    expect(notice.title).toBe("⚠️ API: 80% of this month's request budget used");
    expect(notice.summary).toContain('16,000 of 20,000 requests');
    expect(notice.summary).toContain('slow down to every 15 min');
  });

  it('describes a reached budget for both actions', () => {
    const details = { requests: 20000, budget: 20000, month: '2026-10', slowIntervalSec: 900 };
    const paused = buildNotice({
      noticeKind: 'budget_exceeded',
      monitor,
      dashboardUrl,
      details: { ...details, budgetAction: 'pause' },
    });
    expect(paused.title).toBe('⛔ API: monthly request budget reached');
    expect(paused.summary).toContain('Monitoring is paused');
    const slowed = buildNotice({
      noticeKind: 'budget_exceeded',
      monitor,
      dashboardUrl,
      details: { ...details, budgetAction: 'slow' },
    });
    expect(slowed.summary).toContain('every 15 min');
  });

  it('rejects unknown kinds, and buildAlert refuses notices', () => {
    expect(() => buildNotice({ noticeKind: 'nope', monitor, dashboardUrl })).toThrow();
    expect(() => buildAlert({ kind: 'notice', monitor, dashboardUrl })).toThrow(/buildNotice/);
  });
});
