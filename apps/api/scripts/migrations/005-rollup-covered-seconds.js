// Uptime now comes from confirmed downtime over the time a day was covered
// (DailyRollup.coveredSec). Final rollups written before that have no
// coveredSec: a finished day with checks was watched all day, so they get 86400.
// Rows that already have a coveredSec, and rows without checks, are left alone,
// so running this again changes nothing.
export const name = '005-rollup-covered-seconds';

export async function up(db) {
  const result = await db.collection('dailyrollups').updateMany(
    {
      isFinal: true,
      totalChecks: { $gt: 0 },
      $or: [{ coveredSec: { $exists: false } }, { coveredSec: null }],
    },
    { $set: { coveredSec: 86400 } },
  );
  return { modified: result.modifiedCount };
}
