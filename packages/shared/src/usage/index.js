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
  if (!count) return;
  await MonitorUsage.updateOne(
    { monitorId: monitor._id, month: monthKey(at) },
    { $inc: { requests: count }, $setOnInsert: { workspaceId: monitor.workspaceId } },
    { upsert: true },
  );
}

/** Requests sent this month (0 when nothing was sent yet). */
export async function requestsThisMonth(monitorId, at = new Date()) {
  const usage = await MonitorUsage.findOne({ monitorId, month: monthKey(at) }).lean();
  return usage?.requests ?? 0;
}
