// Daily rollups: compress a day of raw checks into one row per monitor.
// Raw checks expire after 7 days; the 30/90-day uptime and the 90-day bars
// are built from these rows. Node-only (uses models).
import { CheckResult, DailyRollup, Incident } from '../models/index.js';
import { addDays, downtimeWithin, utcDayStart } from '../uptime/index.js';

/**
 * Aggregation that turns one UTC day of check results into DailyRollup rows
 * and upserts them with $merge (on the unique { monitorId, date } index).
 * Re-running it for the same day just overwrites the numbers: idempotent.
 */
export function buildRollupPipeline(dayStart, { isFinal }) {
  const dayEnd = addDays(dayStart, 1);
  return [
    { $match: { timestamp: { $gte: dayStart, $lt: dayEnd } } },
    {
      $group: {
        _id: '$meta.monitorId',
        workspaceId: { $first: '$meta.workspaceId' },
        totalChecks: { $sum: 1 },
        upChecks: { $sum: { $cond: ['$ok', 1, 0] } },
        avgResponseMs: { $avg: '$totalMs' },
        // $percentile needs MongoDB 7.0+; "approximate" is the only method it offers.
        p95: { $percentile: { input: '$totalMs', p: [0.95], method: 'approximate' } },
      },
    },
    {
      $project: {
        _id: 0,
        monitorId: '$_id',
        workspaceId: 1,
        date: { $literal: dayStart },
        totalChecks: 1,
        upChecks: 1,
        avgResponseMs: { $round: ['$avgResponseMs', 1] },
        p95ResponseMs: { $round: [{ $arrayElemAt: ['$p95', 0] }, 1] },
        isFinal: { $literal: isFinal },
      },
    },
    {
      $merge: {
        into: DailyRollup.collection.collectionName,
        on: ['monitorId', 'date'],
        whenMatched: 'merge',
        whenNotMatched: 'insert',
      },
    },
  ];
}

/**
 * Recomputes the rollups of one UTC day: check counts and response times via
 * the aggregation above, then downtime from incidents overlapping the day
 * (more accurate than "failed checks x interval").
 */
export async function rollupDay(day, { isFinal = false, now = new Date() } = {}) {
  const dayStart = utcDayStart(day);
  const dayEnd = addDays(dayStart, 1);

  await CheckResult.aggregate(buildRollupPipeline(dayStart, { isFinal }));

  const incidents = await Incident.find(
    { startedAt: { $lt: dayEnd }, $or: [{ resolvedAt: null }, { resolvedAt: { $gt: dayStart } }] },
    { monitorId: 1, startedAt: 1, resolvedAt: 1 },
  ).lean();

  const byMonitor = new Map();
  for (const incident of incidents) {
    const key = String(incident.monitorId);
    byMonitor.set(key, [...(byMonitor.get(key) ?? []), incident]);
  }
  const rollups = await DailyRollup.find({ date: dayStart }, { monitorId: 1 }).lean();
  if (rollups.length === 0) return 0;

  await DailyRollup.bulkWrite(
    rollups.map((rollup) => ({
      updateOne: {
        filter: { _id: rollup._id },
        update: {
          $set: {
            downtimeSec: downtimeWithin(
              byMonitor.get(String(rollup.monitorId)) ?? [],
              dayStart,
              dayEnd,
              now,
            ),
          },
        },
      },
    })),
  );
  return rollups.length;
}
