// Node-only: records requests sent to customers' endpoints (uses models).
import { monthKey } from '../cost/index.js';
import { MonitorUsage } from '../models/MonitorUsage.js';

/**
 * Adds `count` requests to the monitor's usage for the month of `at`.
 * An upsert with $inc: the first request of a month creates the document.
 * Two concurrent first upserts can't create duplicates: the unique index on
 * { monitorId, month } rejects one, and MongoDB (4.2+) retries that upsert
 * as an update by itself.
 */
export async function recordUsage(monitor, count, at = new Date()) {
  if (!count) return requestsThisMonth(monitor._id, at);
  const usage = await MonitorUsage.findOneAndUpdate(
    { monitorId: monitor._id, month: monthKey(at) },
    { $inc: { requests: count }, $setOnInsert: { workspaceId: monitor.workspaceId } },
    { upsert: true, returnDocument: 'after', projection: { requests: 1 } },
  ).lean();
  // The new monthly total, so the caller can check the budget without another read.
  return usage.requests;
}

/**
 * Sets a "sent once this month" marker (warnedAt / exceededAt) only if it is
 * still unset. Returns true for exactly one caller, even under concurrency.
 */
export async function claimUsageMarker(monitorId, month, marker, at = new Date()) {
  const claimed = await MonitorUsage.findOneAndUpdate(
    { monitorId, month, [marker]: null },
    { $set: { [marker]: at } },
    { projection: { _id: 1 } },
  ).lean();
  return Boolean(claimed);
}

/** Clears budget markers (e.g. after the budget was raised). */
export async function clearUsageMarkers(monitorId, month, markers) {
  await MonitorUsage.updateOne(
    { monitorId, month },
    { $set: Object.fromEntries(markers.map((marker) => [marker, null])) },
  );
}

/** Requests sent this month (0 when nothing was sent yet). */
export async function requestsThisMonth(monitorId, at = new Date()) {
  const usage = await MonitorUsage.findOne({ monitorId, month: monthKey(at) }).lean();
  return usage?.requests ?? 0;
}
