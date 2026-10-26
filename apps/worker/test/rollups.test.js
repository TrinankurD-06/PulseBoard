import { mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { CheckResult, DailyRollup } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { addDays, utcDayStart } from '@pulseboard/shared/uptime';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinalizeRollupJob, createRollupJob } from '../src/jobs/rollups.js';

const logger = createLogger({ name: 'rollup-test' });
beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const monitorId = new mongoose.Types.ObjectId();
const today = utcDayStart(new Date());
const yesterday = addDays(today, -1);

async function insertCheck(timestamp, ok = true) {
  await CheckResult.create({
    timestamp,
    meta: { monitorId, workspaceId: monitorId },
    ok,
    totalMs: 50,
  });
}

describe('rollup jobs', () => {
  it('rollup refreshes today (not final) and finalises a missed yesterday', async () => {
    await insertCheck(new Date(today.getTime() + 1000));
    await insertCheck(new Date(yesterday.getTime() + 1000), false);

    await createRollupJob({ logger })();

    const rows = await DailyRollup.find().sort({ date: 1 }).lean();
    expect(rows.map((r) => [r.date.toISOString(), r.isFinal, r.upChecks])).toEqual([
      [yesterday.toISOString(), true, 0],
      [today.toISOString(), false, 1],
    ]);
  });

  it('finalize-rollup marks yesterday final', async () => {
    await insertCheck(new Date(yesterday.getTime() + 5000));
    await createFinalizeRollupJob({ logger })();
    const row = await DailyRollup.findOne({ date: yesterday }).lean();
    expect(row).toMatchObject({ isFinal: true, totalChecks: 1 });
  });
});
