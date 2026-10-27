import { randomBytes } from 'node:crypto';
import { probeTargetOf } from '@pulseboard/shared/agent';
import { assertSafeUrl, runHttpCheck, UnsafeTargetError } from '@pulseboard/shared/check';
import { appUrlOf } from '@pulseboard/shared/env';
import { budgetSlowIntervalSec, budgetState, isBudgetSlowed } from '@pulseboard/shared/adaptive';
import { liftBudgetRestriction } from '@pulseboard/shared/budget';
import {
  AGENT_SILENCE_STATE,
  MONITOR_STATUS,
  MONITOR_TYPES,
  PAUSED_REASONS,
  ROLES,
} from '@pulseboard/shared/constants';
import { monthKey } from '@pulseboard/shared/cost';
import { resolveOpenIncident } from '@pulseboard/shared/incident';
import {
  AgentReport,
  CheckResult,
  DailyRollup,
  Incident,
  Monitor,
  StatusPage,
} from '@pulseboard/shared/models';
import { hasRole } from '@pulseboard/shared/roles';
import { agentCreateSchema, agentUpdateSchema } from '@pulseboard/shared/schemas';
import { needsCheckJob } from '@pulseboard/shared/scheduling';
import { clearUsageMarkers, recordUsage, requestsThisMonth } from '@pulseboard/shared/usage';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';
import { agentKeyFields, generateAgentKey } from '../agent/agentKey.js';

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

// The fields a user can edit on a heartbeat monitor.
const HEARTBEAT_EDITABLE_FIELDS = ['name', 'expectedEverySec', 'graceSec'];

// The fields a user can edit on an agent monitor.
const AGENT_EDITABLE_FIELDS = [
  'name',
  'reportEverySec',
  'errorRateThreshold',
  'p95ThresholdMs',
  'probeUrl',
  'externalCheckEverySec',
];

const isHeartbeat = (monitor) => monitor.type === MONITOR_TYPES.HEARTBEAT;
const isAgent = (monitor) => monitor.type === MONITOR_TYPES.AGENT;

/** 32 random bytes as base64url: 43 URL-safe characters, unguessable. */
export function generateHeartbeatToken() {
  return randomBytes(32).toString('base64url');
}

/** When a heartbeat that last pinged (or was created/resumed) at `from` becomes overdue. */
export function heartbeatDueAt(monitor, from = new Date()) {
  const periodMs = (monitor.expectedEverySec + monitor.graceSec) * 1000;
  return new Date(new Date(from).getTime() + periodMs);
}

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
 * Custom headers often carry API keys, and a heartbeat token lets anyone report
 * pings. Viewers can see that they exist, but not their values.
 */
export function toMonitorDto(monitor, role) {
  const json = monitor.toJSON();
  // Nobody gets the agent key hash; the key itself is only in create/regenerate responses.
  delete json.agentKeyHash;
  if (monitor.$locals?.agentKey) json.agentKey = monitor.$locals.agentKey;
  if (hasRole(role, ROLES.MEMBER)) return json;
  if (json.headers) {
    json.headers = Object.fromEntries(Object.keys(json.headers).map((name) => [name, '••••••']));
  }
  if (json.heartbeatToken) json.heartbeatToken = '••••••';
  return json;
}

export function createMonitorService({ env, scheduler, schemas }) {
  async function assertTargetAllowed(url, path = 'url') {
    try {
      await assertSafeUrl(url, { allowPrivate: env.ALLOW_PRIVATE_TARGETS });
    } catch (err) {
      if (!(err instanceof UnsafeTargetError)) throw err;
      // Same details shape as validation errors, so the form can show it on the URL field.
      throw new AppError(400, 'UNSAFE_TARGET', err.message, [{ path, message: err.message }]);
    }
  }

  /** The run-check job of an agent monitor exists only while its external check is on. */
  async function syncAgentJob(monitor) {
    if (!monitor.isPaused && needsCheckJob(monitor)) await scheduler.scheduleMonitor(monitor);
    else await scheduler.cancelMonitor(monitor._id);
  }

  /** PATCH for an agent monitor: merge, then re-validate with the create schema. */
  async function updateAgent(monitor, body) {
    const patch = agentUpdateSchema.parse(body ?? {});
    const current = Object.fromEntries(AGENT_EDITABLE_FIELDS.map((f) => [f, monitor.get(f)]));
    const merged = agentCreateSchema.parse({ ...current, ...patch, type: MONITOR_TYPES.AGENT });
    if (merged.probeUrl && merged.probeUrl !== monitor.probeUrl) {
      await assertTargetAllowed(merged.probeUrl, 'probeUrl');
    }
    const { type: _type, ...fields } = merged;
    monitor.set(fields);
    await monitor.save();
    await syncAgentJob(monitor);
    return monitor;
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

  /** PATCH for a heartbeat: the same merge-then-validate pattern as http monitors. */
  async function updateHeartbeat(monitor, body) {
    const patch = schemas.heartbeatUpdate.parse(body ?? {});
    const current = Object.fromEntries(HEARTBEAT_EDITABLE_FIELDS.map((f) => [f, monitor.get(f)]));
    const merged = schemas.heartbeatCreate.parse({
      ...current,
      ...patch,
      type: MONITOR_TYPES.HEARTBEAT,
    });
    const timingChanged =
      merged.expectedEverySec !== monitor.expectedEverySec || merged.graceSec !== monitor.graceSec;
    monitor.set({
      name: merged.name,
      expectedEverySec: merged.expectedEverySec,
      graceSec: merged.graceSec,
    });
    // New timing applies from the last ping (or from now, if there was none yet).
    if (timingChanged && !monitor.isPaused) {
      monitor.nextDueAt = heartbeatDueAt(merged, monitor.lastPingAt ?? new Date());
    }
    await monitor.save();
    return monitor;
  }

  return {
    findInWorkspace,

    list(workspaceId, { page, limit, status }) {
      const filter = { workspaceId, ...(status && { status }) };
      return paginate(Monitor, filter, { page, limit }, (query) => query.sort({ createdAt: -1 }));
    },

    async create(workspaceId, input) {
      // Heartbeat: nothing to check or schedule; the first ping is due after one period.
      if (input.type === MONITOR_TYPES.HEARTBEAT) {
        return Monitor.create({
          type: MONITOR_TYPES.HEARTBEAT,
          name: input.name,
          expectedEverySec: input.expectedEverySec,
          graceSec: input.graceSec,
          heartbeatToken: generateHeartbeatToken(),
          workspaceId,
          status: MONITOR_STATUS.PENDING,
          nextDueAt: heartbeatDueAt(input),
        });
      }
      // Agent: the app reports to us with a key that is shown once (via
      // $locals, never stored readable); the silence detector watches from now.
      if (input.type === MONITOR_TYPES.AGENT) {
        if (input.probeUrl) await assertTargetAllowed(input.probeUrl, 'probeUrl');
        const agentKey = generateAgentKey();
        const { type: _type, ...fields } = input;
        const monitor = await Monitor.create({
          ...fields,
          ...agentKeyFields(agentKey),
          type: MONITOR_TYPES.AGENT,
          workspaceId,
          status: MONITOR_STATUS.PENDING,
          silenceState: AGENT_SILENCE_STATE.REPORTING,
          watchSince: new Date(),
        });
        monitor.$locals.agentKey = agentKey;
        if (needsCheckJob(monitor)) await scheduler.scheduleMonitor(monitor);
        return monitor;
      }
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
    /**
     * `body` is the raw PATCH body: which schema applies depends on the stored
     * monitor's type, so it is validated here rather than in the route.
     */
    async update(workspaceId, monitorId, body) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      // The type is fixed at creation: an http monitor can't become a heartbeat.
      if (body?.type !== undefined && body.type !== (monitor.type ?? MONITOR_TYPES.HTTP)) {
        throw badRequest('The monitor type cannot be changed', [
          { path: 'type', message: 'The monitor type cannot be changed' },
        ]);
      }
      if (isHeartbeat(monitor)) return updateHeartbeat(monitor, body);
      if (isAgent(monitor)) return updateAgent(monitor, body);

      const patch = schemas.update.parse(body ?? {});
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
      if (isHeartbeat(monitor)) {
        // A full period (plus grace) from now before a missing ping counts.
        monitor.set({
          isPaused: false,
          status: MONITOR_STATUS.PENDING,
          pausedReason: null,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          nextDueAt: heartbeatDueAt(monitor, now),
        });
        await monitor.save();
        return monitor;
      }
      if (isAgent(monitor)) {
        // Silence counts from now: the agent gets two report periods to report.
        monitor.set({
          isPaused: false,
          status: MONITOR_STATUS.PENDING,
          pausedReason: null,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          silenceState: AGENT_SILENCE_STATE.REPORTING,
          watchSince: now,
          lastProbeAt: null,
          silentNoticeAt: null,
        });
        await monitor.save();
        await syncAgentJob(monitor);
        return monitor;
      }
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
      if (isHeartbeat(monitor)) {
        throw new AppError(
          400,
          'NOT_SUPPORTED',
          'Heartbeat monitors are not checked by PulseBoard: your job pings them',
        );
      }
      // Agent: the app reports by itself; only the probe URL can be checked.
      if (isAgent(monitor) && !monitor.probeUrl) {
        throw new AppError(
          400,
          'NOT_SUPPORTED',
          'Set a probe URL to test this agent monitor: the app itself reports to PulseBoard',
        );
      }
      const result = await runHttpCheck(isAgent(monitor) ? probeTargetOf(monitor) : monitor, {
        allowPrivate: env.ALLOW_PRIVATE_TARGETS,
        appUrl: appUrlOf(env),
      });
      await recordUsage(monitor, result.requestsSent);
      return result;
    },

    /** New heartbeat token: the old ping URL stops working immediately. */
    async regenerateHeartbeatToken(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      if (!isHeartbeat(monitor)) {
        throw new AppError(400, 'NOT_SUPPORTED', 'Only heartbeat monitors have a ping token');
      }
      monitor.heartbeatToken = generateHeartbeatToken();
      await monitor.save();
      return monitor;
    },

    /** New agent key, returned once (via $locals): the old key gets 401 immediately. */
    async regenerateAgentKey(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      if (!isAgent(monitor)) {
        throw new AppError(400, 'NOT_SUPPORTED', 'Only agent monitors have an agent key');
      }
      const agentKey = generateAgentKey();
      monitor.set(agentKeyFields(agentKey));
      await monitor.save();
      monitor.$locals.agentKey = agentKey;
      return monitor;
    },

    /** Cancels the job first, so no check runs against a half-deleted monitor. */
    async remove(workspaceId, monitorId) {
      const monitor = await findInWorkspace(workspaceId, monitorId);
      await scheduler.cancelMonitor(monitor._id);
      await Promise.all([
        CheckResult.deleteMany({ 'meta.monitorId': monitor._id }),
        AgentReport.deleteMany({ 'meta.monitorId': monitor._id }),
        DailyRollup.deleteMany({ monitorId: monitor._id }),
        Incident.deleteMany({ monitorId: monitor._id }),
        StatusPage.updateMany({ monitorIds: monitor._id }, { $pull: { monitorIds: monitor._id } }),
      ]);
      await monitor.deleteOne();
    },
  };
}
