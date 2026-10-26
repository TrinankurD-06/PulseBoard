import { assertSafeUrl, runHttpCheck, UnsafeTargetError } from '@pulseboard/shared/check';
import { appUrlOf } from '@pulseboard/shared/env';
import { budgetSlowIntervalSec, budgetState, isBudgetSlowed } from '@pulseboard/shared/adaptive';
import { liftBudgetRestriction } from '@pulseboard/shared/budget';
import { MONITOR_STATUS, PAUSED_REASONS, ROLES } from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import { resolveOpenIncident } from '@pulseboard/shared/incident';
import { CheckResult, DailyRollup, Incident, Monitor, StatusPage } from '@pulseboard/shared/models';
import { hasRole } from '@pulseboard/shared/roles';
import { clearUsageMarkers, recordUsage, requestsThisMonth } from '@pulseboard/shared/usage';
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
  'costPer1kRequests',
  'currency',
  'adaptive',
  'minIntervalSec',
  'maxIntervalSec',
  'monthlyRequestBudget',
  'budgetAction',
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

  /**
   * After the budget changed: if this month's usage is now under the budget,
   * lift an active budget restriction right away and reset the "sent once"
   * markers, so the next threshold crossing warns again. A budget LOWERED
   * below current usage takes effect at the next check (the worker enforces it).
   */
  async function reevaluateBudget(monitor, now = new Date()) {
    const month = monthKey(now);
    const requests = await requestsThisMonth(monitor._id, now);
    const state = budgetState(requests, monitor.monthlyRequestBudget);
    if (state === 'exceeded') return;
    await clearUsageMarkers(
      monitor._id,
      month,
      state === 'warning' ? ['exceededAt'] : ['exceededAt', 'warnedAt'],
    );
    if (monitor.budgetExceededMonth === month) await liftBudgetRestriction(monitor._id, scheduler);
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
        // Adaptation starts from the base interval.
        currentIntervalSec: input.intervalSec,
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

      const intervalChanged =
        merged.intervalSec !== monitor.intervalSec || merged.adaptive !== monitor.adaptive;
      const budgetChanged =
        merged.monthlyRequestBudget !== monitor.monthlyRequestBudget ||
        merged.budgetAction !== monitor.budgetAction;

      monitor.set(merged);
      // A new base interval (or switching adaptive on/off) restarts adaptation
      // from the base, unless the budget currently forces the slow interval.
      if (intervalChanged && !isBudgetSlowed(monitor))
        monitor.currentIntervalSec = merged.intervalSec;
      await monitor.save();

      if (budgetChanged) await reevaluateBudget(monitor);
      const fresh = await Monitor.findById(monitor._id);
      // Re-schedule so a changed interval takes effect immediately.
      if (!fresh.isPaused) await scheduler.scheduleMonitor(fresh);
      return fresh;
    },

    async pause(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      monitor.set({
        isPaused: true,
        status: MONITOR_STATUS.PAUSED,
        pausedReason: PAUSED_REASONS.USER,
      });
      await monitor.save();
      await scheduler.cancelMonitor(monitor._id);
      // No checks run while paused, so an open incident could never recover on
      // its own. Close it now (no recovery alert: nothing actually recovered).
      await resolveOpenIncident(monitor._id, {
        resolvedAt: new Date(),
        message: 'Closed because monitoring was paused',
      });
      return monitor;
    },

    /**
     * Resuming starts fresh: counters reset and status is pending until the
     * next check. A monitor paused because this month's budget ran out can only
     * resume after the budget is raised (or next month).
     */
    async resume(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      const now = new Date();
      if (
        monitor.pausedReason === PAUSED_REASONS.BUDGET &&
        monitor.budgetExceededMonth === monthKey(now) &&
        budgetState(await requestsThisMonth(monitor._id, now), monitor.monthlyRequestBudget) ===
          'exceeded'
      ) {
        throw new AppError(
          409,
          'BUDGET_EXCEEDED',
          'Raise the monthly budget to resume this monitor',
        );
      }
      const pausedByBudget = monitor.pausedReason === PAUSED_REASONS.BUDGET;
      monitor.set({
        isPaused: false,
        status: MONITOR_STATUS.PENDING,
        pausedReason: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        ...(pausedByBudget && { budgetExceededMonth: null }),
      });
      // Back to the base interval, unless this month's budget keeps it slowed.
      monitor.currentIntervalSec = isBudgetSlowed(monitor, now)
        ? budgetSlowIntervalSec(monitor)
        : monitor.intervalSec;
      await monitor.save();
      await scheduler.scheduleMonitor(monitor);
      return monitor;
    },

    /**
     * "Test now": runs one check directly in the API process (not via Agenda) so
     * the user sees the result immediately. The result is NOT stored, so it
     * can't affect uptime statistics or incidents.
     */
    async testConfig(config) {
      await assertTargetAllowed(config.url);
      return runHttpCheck(config, {
        allowPrivate: env.ALLOW_PRIVATE_TARGETS,
        appUrl: appUrlOf(env),
      });
    },

    /** Counted in MonitorUsage: it is a real request to the customer's endpoint. */
    async testExisting(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      const result = await runHttpCheck(monitor, {
        allowPrivate: env.ALLOW_PRIVATE_TARGETS,
        appUrl: appUrlOf(env),
      });
      await recordUsage(monitor, result.requestsSent);
      return result;
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
