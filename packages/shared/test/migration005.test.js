import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { up } from '../../../apps/api/scripts/migrations/005-rollup-covered-seconds.js';
import { DailyRollup } from '../src/models/index.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
const row = (day, extra) => ({
  monitorId: new mongoose.Types.ObjectId(),
  workspaceId,
  date: new Date(`2026-03-${day}T00:00:00Z`),
  ...extra,
});

describe('migration 005-rollup-covered-seconds', () => {
  it('backfills only final rollups with checks and no coveredSec, and is idempotent', async () => {
    await DailyRollup.collection.insertMany([
      row('01', { isFinal: true, totalChecks: 10, upChecks: 10 }), // legacy: backfilled
      row('02', { isFinal: true, totalChecks: 10, upChecks: 10, coveredSec: 5000 }), // kept
      row('03', { isFinal: true, totalChecks: 0, upChecks: 0 }), // no checks
      row('04', { isFinal: false, totalChecks: 10, upChecks: 10 }), // not final
    ]);

    expect(await up(mongoose.connection.db)).toEqual({ modified: 1 });
    expect(await up(mongoose.connection.db)).toEqual({ modified: 0 });

    const rows = await DailyRollup.find().sort({ date: 1 }).lean();
    expect(rows.map((r) => r.coveredSec ?? null)).toEqual([86400, 5000, null, null]);
  });
});
