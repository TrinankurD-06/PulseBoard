// The logic behind `npm run seed:clear`, importable so it can be tested against
// an in-memory database.
//
// Removes everything the demo seed created: monitors flagged `isSeed`, all that
// belongs to them (checks, incidents, rollups, usage, agent reports, scheduler
// jobs, status-page entries) and every other document flagged `isSeed`
// (history that older seeds, or migration 004, marked on real monitors).
// Real monitors and their genuine data, users, workspaces and channels stay.
import { JOB_NAMES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import * as defaultModels from '@pulseboard/shared/models';
import { AGENDA_COLLECTION } from '@pulseboard/shared/scheduling';

const idsOf = (docs) => docs.map((doc) => doc._id);

/** Filters selecting seed data: flagged documents plus anything of a seeded monitor. */
function filtersFor(monitorIds) {
  const owned = (field) => ({ $or: [{ isSeed: true }, { [field]: { $in: monitorIds } }] });
  return {
    checks: owned('meta.monitorId'),
    reports: owned('meta.monitorId'),
    rollups: owned('monitorId'),
    usage: owned('monitorId'),
    incidents: owned('monitorId'),
  };
}

async function seededMonitorIds(models) {
  return idsOf(await models.Monitor.find({ isSeed: true }, { _id: 1 }).lean());
}

/** What clearSeedData would delete, without deleting anything. */
export async function countSeedData({ models = defaultModels, db = mongoose.connection.db } = {}) {
  const monitorIds = await seededMonitorIds(models);
  const filter = filtersFor(monitorIds);
  const [checks, reports, rollups, usage, incidents, jobs, statusPages] = await Promise.all([
    models.CheckResult.countDocuments(filter.checks),
    models.AgentReport.countDocuments(filter.reports),
    models.DailyRollup.countDocuments(filter.rollups),
    models.MonitorUsage.countDocuments(filter.usage),
    models.Incident.countDocuments(filter.incidents),
    db.collection(AGENDA_COLLECTION).countDocuments(jobFilter(monitorIds)),
    models.StatusPage.countDocuments({ monitorIds: { $in: monitorIds } }),
  ]);
  return {
    monitors: monitorIds.length,
    incidents,
    rollups,
    checks,
    usage,
    agentReports: reports,
    jobs,
    statusPages,
  };
}

const jobFilter = (monitorIds) => ({
  name: JOB_NAMES.RUN_CHECK,
  'data.monitorId': { $in: monitorIds.map(String) },
});

/**
 * Deletes all seed data and returns how much of each kind was removed.
 * Safe to run again: the second run finds nothing and deletes nothing.
 */
export async function clearSeedData({
  models = defaultModels,
  db = mongoose.connection.db,
  logger = console,
} = {}) {
  const monitorIds = await seededMonitorIds(models);
  const filter = filtersFor(monitorIds);

  // Jobs first, so no check runs against a half-deleted monitor.
  const jobs = monitorIds.length
    ? await db.collection(AGENDA_COLLECTION).deleteMany(jobFilter(monitorIds))
    : { deletedCount: 0 };
  const statusPages = monitorIds.length
    ? await models.StatusPage.updateMany(
        { monitorIds: { $in: monitorIds } },
        { $pull: { monitorIds: { $in: monitorIds } } },
      )
    : { modifiedCount: 0 };

  // Time-series collections (checks, agent reports) take arbitrary delete filters on MongoDB 7.0+.
  const [checks, reports, rollups, usage, incidents] = await Promise.all([
    models.CheckResult.deleteMany(filter.checks),
    models.AgentReport.deleteMany(filter.reports),
    models.DailyRollup.deleteMany(filter.rollups),
    models.MonitorUsage.deleteMany(filter.usage),
    models.Incident.deleteMany(filter.incidents),
  ]);
  const monitors = await models.Monitor.deleteMany({ _id: { $in: monitorIds } });

  const result = {
    monitors: monitors.deletedCount,
    incidents: incidents.deletedCount,
    rollups: rollups.deletedCount,
    checks: checks.deletedCount,
    usage: usage.deletedCount,
    agentReports: reports.deletedCount,
    jobs: jobs.deletedCount,
    statusPages: statusPages.modifiedCount,
  };
  logger.warn?.(`Cleared seed data: ${JSON.stringify(result)}`);
  return result;
}
