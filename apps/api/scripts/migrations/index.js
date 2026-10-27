import * as monitorTypesAndCost from './001-monitor-types-and-cost.js';
import * as adaptiveAndBudget from './002-adaptive-and-budget.js';
import * as userIdentities from './003-user-identities.js';
import * as markLegacySampleData from './004-mark-legacy-sample-data.js';
import * as rollupCoveredSeconds from './005-rollup-covered-seconds.js';

// All migrations, in the order they must run. Add new ones at the end.
export const migrations = [
  monitorTypesAndCost,
  adaptiveAndBudget,
  userIdentities,
  markLegacySampleData,
  rollupCoveredSeconds,
];

const APPLIED = 'migrations';

/**
 * Runs every migration that hasn't been applied yet and records it in the
 * `migrations` collection. Each migration is also idempotent by itself, so a
 * crash between "migrate" and "record" is harmless: the next run repeats it
 * and nothing changes twice.
 */
export async function runMigrations(db, { logger = console } = {}) {
  const applied = db.collection(APPLIED);
  const done = new Set(
    (await applied.find({}, { projection: { _id: 1 } }).toArray()).map((m) => m._id),
  );
  const ran = [];

  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    const result = await migration.up(db);
    await applied.updateOne(
      { _id: migration.name },
      { $set: { appliedAt: new Date(), result } },
      { upsert: true },
    );
    logger.warn(`Applied migration ${migration.name}: ${JSON.stringify(result)}`);
    ran.push(migration.name);
  }
  return ran;
}
