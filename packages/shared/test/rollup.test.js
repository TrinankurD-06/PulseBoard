import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CheckResult, DailyRollup, Incident } from '../src/models/index.js';
import { rollupDay } from '../src/rollup/index.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
const monitorA = new mongoose.Types.ObjectId();
const monitorB = new mongoose.Types.ObjectId();
const at = (time, day = '10') => new Date(`2026-03-${day}T${time}Z`);

async function insertChecks(monitorId, checks) {
  await CheckResult.insertMany(
    checks.map(([time, ok, totalMs, day]) => ({
      timestamp: at(time, day),
      meta: { monitorId, workspaceId },
      ok,
      totalMs,
    })),
  );
}

describe('rollupDay', () => {
  beforeEach(async () => {
    // 20 checks for A on the 10th: 18 up (100ms ... 1800ms), 2 down.
    await insertChecks(
      monitorA,
      Array.from({ length: 20 }, (_, i) => [
        `10:${String(i).padStart(2, '0')}:00`,
        i < 18,
        (i + 1) * 100,
      ]),
    );
    await insertChecks(monitorB, [['08:00:00', true, 50]]);
    // Checks on other days must be ignored.
    await insertChecks(monitorA, [
      ['23:59:59', false, 999, '09'],
      ['00:00:00', false, 999, '11'],
    ]);
    // A 90-second incident for A that day.
    await Incident.create({
      monitorId: monitorA,
      workspaceId,
      startedAt: at('10:18:00'),
      resolvedAt: at('10:19:30'),
    });
  });

  it('computes counts, average, p95 and downtime per monitor', async () => {
    expect(await rollupDay(at('12:00:00'), { now: at('23:00:00') })).toBe(2);

    const a = await DailyRollup.findOne({ monitorId: monitorA }).lean();
    expect(a).toMatchObject({
      workspaceId,
      date: new Date('2026-03-10T00:00:00Z'),
      totalChecks: 20,
      upChecks: 18,
      avgResponseMs: 1050,
      downtimeSec: 90,
      isFinal: false,
    });
    expect(a.p95ResponseMs).toBeGreaterThanOrEqual(1900);

    const b = await DailyRollup.findOne({ monitorId: monitorB }).lean();
    expect(b).toMatchObject({ totalChecks: 1, upChecks: 1, downtimeSec: 0 });
  });

  it('is idempotent: re-running updates rows instead of duplicating them', async () => {
    await rollupDay(at('12:00:00'));
    await insertChecks(monitorB, [['09:00:00', false, 70]]);
    await rollupDay(at('12:00:00'), { isFinal: true });

    expect(await DailyRollup.countDocuments()).toBe(2);
    const b = await DailyRollup.findOne({ monitorId: monitorB }).lean();
    expect(b).toMatchObject({ totalChecks: 2, upChecks: 1, isFinal: true });
  });

  it('does nothing for a day without checks', async () => {
    expect(await rollupDay(at('12:00:00', '01'))).toBe(0);
  });
});
