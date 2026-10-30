import {
  ALERT_CHANNEL_TYPES,
  MONITOR_TYPES,
  POLLING_BASELINE_MONTHLY_REQUESTS,
} from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import { mongoose } from '@pulseboard/shared/db';
import {
  AdminAuditLog,
  AlertLog,
  DailyRollup,
  ErrorLog,
  Incident,
  Monitor,
  MonitorUsage,
  User,
  Workspace,
} from '@pulseboard/shared/models';
import { AGENDA_COLLECTION } from '@pulseboard/shared/scheduling';
import { clampPage, OBJECT_ID } from './adminShared.js';
import { auditRow } from './serializers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUSES = ['up', 'down', 'pending', 'paused', 'degraded'];
// A worker runs `heartbeat-overdue` every 30 seconds; no finish for 3 minutes means it is not running.
const WORKER_STALE_MS = 3 * 60 * 1000;

const dayKey = (date) => date.toISOString().slice(0, 10);
const zeroed = (keys, fill = 0) => Object.fromEntries(keys.map((key) => [key, fill]));

/** The platform overview, system health and the audit log reader. */
export function createPlatformAdmin({ getRealtimeStatus = () => 'not_started' } = {}) {
  const startedAt = new Date(Date.now() - process.uptime() * 1000);

  return {
    async overview(now = new Date()) {
      const since7 = new Date(now.getTime() - 7 * DAY_MS);
      const since30 = new Date(now.getTime() - 30 * DAY_MS);
      const month = monthKey(now);

      const [
        usersTotal,
        users7,
        users30,
        usersSuspended,
        workspacesTotal,
        workspacesSuspended,
        byType,
        byStatus,
        incidentsOpen,
        incidents30,
        rollups,
        alertRows,
        alertFirst,
        pushMonitors,
        usageRows,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: since7 } }),
        User.countDocuments({ createdAt: { $gte: since30 } }),
        User.countDocuments({ suspendedAt: { $ne: null } }),
        Workspace.countDocuments(),
        Workspace.countDocuments({ suspendedAt: { $ne: null } }),
        Monitor.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]),
        Monitor.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        Incident.countDocuments({ resolvedAt: null }),
        Incident.countDocuments({ startedAt: { $gte: since30 } }),
        DailyRollup.aggregate([
          { $match: { date: { $gte: new Date(dayKey(since30) + 'T00:00:00.000Z') } } },
          { $group: { _id: '$date', checks: { $sum: '$totalChecks' } } },
        ]),
        AlertLog.aggregate([
          { $group: { _id: { type: '$channelType', ok: '$ok' }, n: { $sum: 1 } } },
        ]),
        AlertLog.findOne().sort({ at: 1 }).select('at').lean(),
        Monitor.find({ type: { $in: [MONITOR_TYPES.HEARTBEAT, MONITOR_TYPES.AGENT] } })
          .select('_id')
          .lean(),
        MonitorUsage.aggregate([
          { $match: { month } },
          { $group: { _id: '$monitorId', requests: { $sum: '$requests' } } },
        ]),
      ]);

      const typeCounts = zeroed(Object.values(MONITOR_TYPES));
      for (const row of byType) typeCounts[row._id] = row.n;
      const statusCounts = zeroed(STATUSES);
      for (const row of byStatus) statusCounts[row._id] = row.n;

      // 30 days, oldest first, zeros included.
      const perDay = new Map(rollups.map((row) => [dayKey(row._id), row.checks]));
      const checksPerDay = Array.from({ length: 30 }, (_, index) => {
        const date = dayKey(new Date(now.getTime() - (29 - index) * DAY_MS));
        return { date, checks: perDay.get(date) ?? 0 };
      });

      const perChannel = Object.fromEntries(
        ALERT_CHANNEL_TYPES.map((type) => [type, { sent: 0, failed: 0 }]),
      );
      for (const row of alertRows) {
        perChannel[row._id.type][row._id.ok ? 'sent' : 'failed'] += row.n;
      }

      // The same baseline the rest of the app uses: polling every minute is 43,200 requests a month.
      const pushIds = new Set(pushMonitors.map((m) => String(m._id)));
      const requestsSent = usageRows.reduce((sum, row) => sum + row.requests, 0);
      const pushRequests = usageRows
        .filter((row) => pushIds.has(String(row._id)))
        .reduce((sum, row) => sum + row.requests, 0);

      return {
        users: { total: usersTotal, new7: users7, new30: users30, suspended: usersSuspended },
        workspaces: { total: workspacesTotal, suspended: workspacesSuspended },
        monitors: {
          total: Object.values(typeCounts).reduce((a, b) => a + b, 0),
          failingNow: statusCounts.down,
          byType: typeCounts,
          byStatus: statusCounts,
        },
        incidents: { open: incidentsOpen, last30: incidents30 },
        checksPerDay,
        alerts: { since: alertFirst?.at ?? null, perChannel },
        requestsSaved: {
          month,
          requestsSent,
          requestsSaved: Math.max(
            0,
            pushIds.size * POLLING_BASELINE_MONTHLY_REQUESTS - pushRequests,
          ),
        },
      };
    },

    async system(now = new Date()) {
      const jobs = mongoose.connection.db.collection(AGENDA_COLLECTION);
      const [pending, running, failed, oldest, lastRun, recentFailures, failures24h, errors] =
        await Promise.all([
          jobs.countDocuments({
            nextRunAt: { $lte: now },
            lockedAt: null,
            disabled: { $ne: true },
          }),
          jobs.countDocuments({ lockedAt: { $ne: null } }),
          jobs.countDocuments({
            failedAt: { $ne: null },
            $expr: { $gte: ['$failedAt', { $ifNull: ['$lastFinishedAt', '$failedAt'] }] },
          }),
          jobs.findOne(
            { nextRunAt: { $lte: now }, lockedAt: null, disabled: { $ne: true } },
            { sort: { nextRunAt: 1 }, projection: { nextRunAt: 1 } },
          ),
          jobs.findOne({ name: 'heartbeat-overdue' }, { projection: { lastFinishedAt: 1 } }),
          AlertLog.find({ ok: false }).sort({ at: -1 }).limit(20).lean(),
          AlertLog.aggregate([
            { $match: { ok: false, at: { $gte: new Date(now.getTime() - DAY_MS) } } },
            { $group: { _id: '$channelType', n: { $sum: 1 } } },
          ]),
          ErrorLog.find().sort({ at: -1 }).limit(50).lean(),
        ]);

      const lastRunAt = lastRun?.lastFinishedAt ?? null;
      let worker = 'unknown';
      if (lastRunAt) worker = now - lastRunAt < WORKER_STALE_MS ? 'running' : 'stale';

      const last24h = zeroed(ALERT_CHANNEL_TYPES);
      for (const row of failures24h) last24h[row._id] = row.n;

      return {
        api: { status: 'ok', uptimeSec: Math.round(process.uptime()), startedAt },
        worker: { status: worker, lastRunAt },
        queue: { pending, running, failed, oldestDueAt: oldest?.nextRunAt ?? null },
        changeStreams: getRealtimeStatus(),
        alertFailures: {
          last24h,
          recent: recentFailures.map((row) => ({
            at: row.at,
            channelType: row.channelType,
            error: row.error ?? null,
            incidentId: row.incidentId ? String(row.incidentId) : null,
          })),
        },
        errors: errors.map((row) => ({
          at: row.at,
          method: row.method ?? null,
          route: row.route ?? null,
          status: row.status ?? 500,
          code: row.code ?? null,
          message: row.message ?? null,
        })),
      };
    },

    async audit({ adminId, action, targetType, from, to, ...paging } = {}) {
      const { page, limit } = clampPage(paging);
      const filter = {};
      if (adminId) filter.adminId = OBJECT_ID.test(adminId) ? adminId : null;
      if (action) filter.action = action;
      if (targetType) filter.targetType = targetType;
      if (from || to) {
        filter.at = {};
        if (from) filter.at.$gte = new Date(from);
        if (to) filter.at.$lte = new Date(to);
      }
      const [total, rows] = await Promise.all([
        AdminAuditLog.countDocuments(filter),
        AdminAuditLog.find(filter)
          .sort({ at: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return { data: rows.map(auditRow), pagination: { total, page, limit } };
    },
  };
}
