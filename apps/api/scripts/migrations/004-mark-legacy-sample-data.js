// Mark the sample history that older seeds put on real monitors.
//
// Before `isSeed` existed, the seed backfilled history for every monitor it
// created, including real sites. History cannot predate its monitor, so anything
// older than a monitor's creation is sample data:
//   - incidents that started before the monitor was created get isSeed: true
//   - daily rollups for days entirely before the creation day get isSeed: true
//   - raw check results older than the creation time are deleted (time-series
//     documents cannot be updated in place)
// Data created at or after the monitor's creation is never touched. Monitors
// that are already isSeed (the fictional demo ones, backdated by design) are
// skipped. Running it again finds nothing left to change.
export const name = '004-mark-legacy-sample-data';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function up(db) {
  const monitors = db.collection('monitors');
  const incidents = db.collection('incidents');
  const rollups = db.collection('dailyrollups');
  const checks = db.collection('checkresults');

  let incidentsMarked = 0;
  let rollupsMarked = 0;
  let checksDeleted = 0;

  const cursor = monitors.find(
    { isSeed: { $ne: true }, createdAt: { $type: 'date' } },
    { projection: { _id: 1, createdAt: 1 } },
  );
  for await (const monitor of cursor) {
    const createdAt = monitor.createdAt;
    const creationDay = new Date(Math.floor(createdAt.getTime() / DAY_MS) * DAY_MS);

    const marked = await incidents.updateMany(
      { monitorId: monitor._id, startedAt: { $lt: createdAt }, isSeed: { $ne: true } },
      { $set: { isSeed: true } },
    );
    incidentsMarked += marked.modifiedCount;

    const days = await rollups.updateMany(
      { monitorId: monitor._id, date: { $lt: creationDay }, isSeed: { $ne: true } },
      { $set: { isSeed: true } },
    );
    rollupsMarked += days.modifiedCount;

    const removed = await checks.deleteMany({
      'meta.monitorId': monitor._id,
      timestamp: { $lt: createdAt },
    });
    checksDeleted += removed.deletedCount;
  }
  return { incidentsMarked, rollupsMarked, checksDeleted };
}
