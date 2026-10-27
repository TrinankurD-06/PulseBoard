import mongoose from 'mongoose';
import {
  DEFAULT_EXPECTED_STATUS,
  DEFAULT_TIMEOUT_MS,
  ADAPTIVE_DEFAULT_MAX_INTERVAL_SEC,
  AGENT_SILENCE_STATE,
  BUDGET_ACTIONS,
  CURRENCIES,
  DEFAULT_CURRENCY,
  HTTP_METHODS,
  MONITOR_STATUS,
  MONITOR_TYPES,
  MIN_INTERVAL_SEC,
  PAUSED_REASONS,
} from '../constants.js';
import { baseOptions } from './_options.js';

// url and intervalSec only make sense for monitors PulseBoard polls; push
// monitors (heartbeat) have neither. Missing type = http (older documents).
function isPolled() {
  return (this.type ?? MONITOR_TYPES.HTTP) === MONITOR_TYPES.HTTP;
}

export const timingsSchema = new mongoose.Schema(
  {
    dnsMs: Number,
    tcpMs: Number,
    tlsMs: Number,
    ttfbMs: Number,
    downloadMs: Number,
  },
  { _id: false },
);

const monitorSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    type: { type: String, enum: Object.values(MONITOR_TYPES), default: MONITOR_TYPES.HTTP },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    url: { type: String, required: isPolled, trim: true },
    method: { type: String, enum: HTTP_METHODS, default: 'GET' },
    // Interval bounds depend on DEMO_MODE, so they are enforced by the Zod schema in the API.
    intervalSec: { type: Number, required: isPolled, min: 10 },
    timeoutMs: { type: Number, default: DEFAULT_TIMEOUT_MS },
    expectedStatus: {
      min: { type: Number, default: DEFAULT_EXPECTED_STATUS.min },
      max: { type: Number, default: DEFAULT_EXPECTED_STATUS.max },
    },
    keyword: { type: String, default: null },
    headers: { type: Map, of: String, default: undefined },
    // Set by the worker when the server answered HEAD with 405/501; checks then use GET.
    headUnsupported: { type: Boolean, default: false },

    // Cost estimator: the customer's own price per 1,000 requests to this endpoint.
    costPer1kRequests: { type: Number, default: null },
    currency: { type: String, enum: CURRENCIES, default: DEFAULT_CURRENCY },
    isPaused: { type: Boolean, default: false },
    // Why it is paused: by a user, or automatically because the monthly budget ran out.
    pausedReason: { type: String, enum: [...Object.values(PAUSED_REASONS), null], default: null },

    // Adaptive interval (U2). intervalSec is the BASE interval; currentIntervalSec is
    // what the check job actually uses (null = intervalSec).
    adaptive: { type: Boolean, default: false },
    minIntervalSec: { type: Number, default: MIN_INTERVAL_SEC },
    maxIntervalSec: { type: Number, default: ADAPTIVE_DEFAULT_MAX_INTERVAL_SEC },
    currentIntervalSec: { type: Number, default: null },
    // Time-weighted moving average of response times (~24 h), for spike detection.
    responseEwmaMs: { type: Number, default: null },
    responseEwmaAt: { type: Date, default: null },

    // Monthly request budget (U2): null = no budget.
    monthlyRequestBudget: { type: Number, default: null },
    budgetAction: { type: String, enum: BUDGET_ACTIONS, default: 'slow' },
    // "YYYY-MM" of the month whose budget ran out (restriction active), else null.
    budgetExceededMonth: { type: String, default: null },
    // Heartbeat monitors (U3): the customer's job calls /ping/<token>.
    expectedEverySec: { type: Number, default: undefined },
    graceSec: { type: Number, default: undefined },
    // Secret in the ping URL; unique (sparse: other monitor types have none).
    heartbeatToken: { type: String, default: undefined },
    lastPingAt: { type: Date, default: null },
    lastStartAt: { type: Date, default: null },
    // When a missing ping becomes a failure: last ping (or creation/resume)
    // + expectedEverySec + graceSec. Advanced one period per missed period.
    nextDueAt: { type: Date, default: null },

    // Agent monitors (U4): the customer's app reports metrics with a key.
    // Only the SHA-256 of the key is stored (sparse unique: other types have none).
    agentKeyHash: { type: String, default: undefined },
    agentKeyPrefix: { type: String, default: undefined },
    reportEverySec: { type: Number, default: undefined },
    errorRateThreshold: { type: Number, default: undefined },
    p95ThresholdMs: { type: Number, default: null },
    // Optional URL probed when the agent goes silent (and by the external check).
    probeUrl: { type: String, default: null, trim: true },
    externalCheckEverySec: { type: Number, default: null },
    lastReportAt: { type: Date, default: null },
    // Silence is measured from lastReportAt, or from this (creation / resume)
    // before the first report, so a resumed monitor isn't silent at once.
    watchSince: { type: Date, default: null },
    silenceState: {
      type: String,
      enum: [...Object.values(AGENT_SILENCE_STATE), null],
      default: null,
    },
    // Last probe sequence, for "re-probe every 5 minutes while silent".
    lastProbeAt: { type: Date, default: null },
    // Once-per-silence marker for the "agent silent, endpoint reachable" notice.
    silentNoticeAt: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(MONITOR_STATUS),
      default: MONITOR_STATUS.PENDING,
    },

    // Incident state machine counters (updated atomically by the worker).
    consecutiveFailures: { type: Number, default: 0 },
    consecutiveSuccesses: { type: Number, default: 0 },
    // When the current failure / success streak began. Incidents use them so
    // startedAt is the first failed check and resolvedAt the first good one,
    // not the moment the threshold was crossed.
    failingSince: { type: Date, default: null },
    failingCause: { type: String, default: null },
    recoveringSince: { type: Date, default: null },

    // Denormalised "latest check" fields. Time-series collections cannot be
    // watched with change streams, so the worker copies each result here and
    // the API's change stream on monitors pushes it to the browser.
    lastCheckedAt: { type: Date, default: null },
    lastResponseMs: { type: Number, default: null },
    lastOk: { type: Boolean, default: null },
    lastStatusCode: { type: Number, default: null },
    lastError: { type: String, default: null },
    lastTimings: { type: timingsSchema, default: null },
    sslExpiresAt: { type: Date, default: null },
  },
  baseOptions,
);

// Dashboard list for a workspace, newest first.
monitorSchema.index({ workspaceId: 1, createdAt: -1 });
// Worker reconcile on boot: "all active monitors".
monitorSchema.index({ isPaused: 1 });
// Ping lookup by token; sparse because only heartbeat monitors have one.
monitorSchema.index({ heartbeatToken: 1 }, { unique: true, sparse: true });
// Overdue detector: "active heartbeats whose next ping is due".
monitorSchema.index({ type: 1, isPaused: 1, nextDueAt: 1 });
// Report lookup by key hash; sparse because only agent monitors have one.
monitorSchema.index({ agentKeyHash: 1 }, { unique: true, sparse: true });
// Silence detector: "active agents that are reporting / silent".
monitorSchema.index({ type: 1, isPaused: 1, silenceState: 1 });

export const Monitor = mongoose.models.Monitor || mongoose.model('Monitor', monitorSchema);
