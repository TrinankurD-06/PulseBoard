// The database side of uptime (Node only): loads what the uptime formula needs
// for a monitor and evaluates it. The formula itself is computeUptimeFromParts
// in ./index.js; every surface goes through computeUptime or the loaders here,
// so the gauge, the Uptime card, the bars, the status pages and the rollups
// cannot disagree.
import { effectiveIntervalSec } from '../adaptive/index.js';
import { CHECK_STATE } from '../constants.js';
import mongoose from 'mongoose';
import { CheckResult, DailyRollup, Incident, Monitor } from '../models/index.js';
import { computeUptimeFromParts, DAY_MS, mergeIntervals, utcDayStart } from './index.js';

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * When we started watching a monitor: the earlier of its first stored result
 * (one the checker could judge, not an offline one) and the start of coverage
 * of its oldest past daily rollup (raw results only live
 * 7 days, rollups much longer). null when there is neither: a monitor that has
 * produced nothing has no uptime to report ("no data", not 100%), which is why
 * the monitor's creation time is not used.
 */
export async function getWatchStart(monitorId) {
  const id = toObjectId(monitorId);
  const [first, oldest] = await Promise.all([
    CheckResult.findOne(
      { 'meta.monitorId': id, state: { $ne: CHECK_STATE.UNKNOWN } },
      { timestamp: 1 },
    )
      .sort({ timestamp: 1 })
      .lean(),
    DailyRollup.findOne(
      { monitorId: id, date: { $lt: utcDayStart(new Date()) }, coveredSec: { $gt: 0 } },
      { date: 1, coveredSec: 1 },
    )
      .sort({ date: 1 })
      .lean(),
  ]);
  const candidates = [];
  if (first) candidates.push(new Date(first.timestamp).getTime());
  if (oldest) {
    // A past day was watched for its last coveredSec seconds.
    candidates.push(new Date(oldest.date).getTime() + DAY_MS - oldest.coveredSec * 1000);
  }
  return candidates.length ? new Date(Math.min(...candidates)) : null;
}

/** Incidents of a monitor that overlap [from, now): what downtime is computed from. */
export const getIncidentsSince = (monitorId, from, now) =>
  Incident.find(
    {
      monitorId: toObjectId(monitorId),
      startedAt: { $lt: now },
      $or: [{ resolvedAt: null }, { resolvedAt: { $gt: from } }],
    },
    { startedAt: 1, resolvedAt: 1, isSeed: 1 },
  ).lean();

/**
 * Time that is neither up nor down, as [startMs, endMs] intervals:
 *  - paused time (Monitor.pauses; a monitor paused before pauses were recorded
 *    counts as paused since its last result),
 *  - time the checker itself was offline: each unknown result stands for one
 *    check interval. Raw results live 7 days, so older offline time is only
 *    known through the rollups, which already leave it out of coveredSec.
 */
export async function getExclusions(monitorId, from, now) {
  const id = toObjectId(monitorId);
  const monitor = await Monitor.findById(id, {
    pauses: 1,
    isPaused: 1,
    intervalSec: 1,
    currentIntervalSec: 1,
    updatedAt: 1,
  }).lean();
  if (!monitor) return [];
  const nowMs = new Date(now).getTime();

  const intervals = [];
  const pauses = monitor.pauses ?? [];
  for (const pause of pauses) {
    intervals.push([new Date(pause.from).getTime(), new Date(pause.to ?? now).getTime()]);
  }
  if (monitor.isPaused && !pauses.some((p) => !p.to)) {
    const last = await CheckResult.findOne({ 'meta.monitorId': id }, { timestamp: 1 })
      .sort({ timestamp: -1 })
      .lean();
    intervals.push([new Date(last?.timestamp ?? monitor.updatedAt).getTime(), nowMs]);
  }

  // Heartbeat and agent monitors have no check interval; they never produce unknown results anyway.
  const stepMs = (effectiveIntervalSec(monitor) || 60) * 1000;
  const unknown = await CheckResult.find(
    {
      'meta.monitorId': id,
      state: CHECK_STATE.UNKNOWN,
      timestamp: { $gte: new Date(new Date(from).getTime() - stepMs), $lte: now },
    },
    { timestamp: 1 },
  ).lean();
  for (const result of unknown) {
    const at = new Date(result.timestamp).getTime();
    intervals.push([at, at + stepMs]);
  }
  return mergeIntervals(intervals);
}

/** Everything the formula needs for a monitor from `from` to `now`, loaded once for many windows. */
export async function loadUptimeInputs(monitorId, from, now = new Date()) {
  const [incidents, exclusions, watchStart] = await Promise.all([
    getIncidentsSince(monitorId, from, now),
    getExclusions(monitorId, from, now),
    getWatchStart(monitorId),
  ]);
  return { incidents, exclusions, watchStart, now };
}

/** Uptime of one window from already loaded inputs (see loadUptimeInputs). */
export function uptimeInWindow(inputs, from, to) {
  // Never recorded anything: no figures, which is not 100%.
  if (!inputs.watchStart) return { uptime: null, downtimeSec: 0, coveredSec: 0 };
  return computeUptimeFromParts({ ...inputs, from, to });
}

/**
 * computeUptime(monitorId, from, to): 1 - confirmed incident downtime / watched
 * time in [from, to), without paused time and without time the checker was
 * offline. Returns { uptime (percent or null), downtimeSec, coveredSec }.
 */
export async function computeUptime(monitorId, from, to, { now = new Date(), inputs } = {}) {
  const loaded = inputs ?? (await loadUptimeInputs(monitorId, from, now));
  return uptimeInWindow(loaded, from, to);
}
