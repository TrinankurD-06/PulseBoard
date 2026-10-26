import { assertSafeUrl, UnsafeTargetError } from '@pulseboard/shared/check';
import { MONITOR_STATUS, ROLES } from '@pulseboard/shared/constants';
import { CheckResult, DailyRollup, Incident, Monitor, StatusPage } from '@pulseboard/shared/models';
import { hasRole } from '@pulseboard/shared/roles';
import { AppError, notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

// Fields a user can edit. Everything else on Monitor is written by the worker.
const EDITABLE_FIELDS = [
  'name',
  'url',
  'method',
  'intervalSec',
  'timeoutMs',
  'expectedStatus',
  'keyword',
  'headers',
];

function editableFields(monitor) {
  const fields = {};
  for (const field of EDITABLE_FIELDS) {
    const value = monitor.get(field);
    if (field === 'headers') fields.headers = value ? Object.fromEntries(value) : undefined;
    else if (field === 'expectedStatus') fields.expectedStatus = { min: value.min, max: value.max };
    else fields[field] = value;
  }
  return fields;
}

/**
 * Custom headers often carry API keys. Viewers can see which headers are sent,
 * but not their values.
 */
export function toMonitorDto(monitor, role) {
  const json = monitor.toJSON();
  if (json.headers && !hasRole(role, ROLES.MEMBER)) {
    json.headers = Object.fromEntries(Object.keys(json.headers).map((name) => [name, '••••••']));
  }
  return json;
}

export function createMonitorService({ env, scheduler, schemas }) {
  async function assertTargetAllowed(url) {
    try {
      await assertSafeUrl(url, { allowPrivate: env.ALLOW_PRIVATE_TARGETS });
    } catch (err) {
      if (!(err instanceof UnsafeTargetError)) throw err;
      // Same details shape as validation errors, so the form can show it on the URL field.
      throw new AppError(400, 'UNSAFE_TARGET', err.message, [
        { path: 'url', message: err.message },
      ]);
    }
  }

  async function findInWorkspace(workspaceId, monitorId) {
    if (!OBJECT_ID.test(monitorId)) throw notFound('Monitor not found');
    // Filtering by workspace too means a monitor id from another workspace is just "not found".
    const monitor = await Monitor.findOne({ _id: monitorId, workspaceId });
    if (!monitor) throw notFound('Monitor not found');
    return monitor;
  }

  return {
    findInWorkspace,

    list(workspaceId, { page, limit, status }) {
      const filter = { workspaceId, ...(status && { status }) };
      return paginate(Monitor, filter, { page, limit }, (query) => query.sort({ createdAt: -1 }));
    },

    async create(workspaceId, input) {
      await assertTargetAllowed(input.url);
      const monitor = await Monitor.create({
        ...input,
        workspaceId,
        status: MONITOR_STATUS.PENDING,
      });
      await scheduler.scheduleMonitor(monitor);
      return monitor;
    },

    /**
     * Applies a partial update, then re-validates the merged monitor with the
     * full create schema, so cross-field rules (timeout <= interval) still hold.
     */
    async update(workspaceId, monitorId, patch) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      const merged = schemas.create.parse({ ...editableFields(monitor), ...patch });
      if (merged.url !== monitor.url) await assertTargetAllowed(merged.url);

      monitor.set(merged);
      await monitor.save();
      // Re-schedule so a changed interval takes effect immediately.
      if (!monitor.isPaused) await scheduler.scheduleMonitor(monitor);
      return monitor;
    },

    async pause(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      monitor.set({ isPaused: true, status: MONITOR_STATUS.PAUSED });
      await monitor.save();
      await scheduler.cancelMonitor(monitor._id);
      return monitor;
    },

    /** Resuming starts fresh: counters reset and status is pending until the next check. */
    async resume(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      monitor.set({
        isPaused: false,
        status: MONITOR_STATUS.PENDING,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });
      await monitor.save();
      await scheduler.scheduleMonitor(monitor);
      return monitor;
    },

    /** Cancels the job first, so no check runs against a half-deleted monitor. */
    async remove(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      await scheduler.cancelMonitor(monitor._id);
      await Promise.all([
        CheckResult.deleteMany({ 'meta.monitorId': monitor._id }),
        DailyRollup.deleteMany({ monitorId: monitor._id }),
        Incident.deleteMany({ monitorId: monitor._id }),
        StatusPage.updateMany({ monitorIds: monitor._id }, { $pull: { monitorIds: monitor._id } }),
      ]);
      await monitor.deleteOne();
    },
  };
}
