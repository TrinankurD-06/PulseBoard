import mongoose from 'mongoose';
import {
  DEFAULT_EXPECTED_STATUS,
  DEFAULT_TIMEOUT_MS,
  ADAPTIVE_DEFAULT_MAX_INTERVAL_SEC,
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
    url: { type: String, required: true, trim: true },
    method: { type: String, enum: HTTP_METHODS, default: 'GET' },
    // Interval bounds depend on DEMO_MODE, so they are enforced by the Zod schema in the API.
    intervalSec: { type: Number, required: true, min: 10 },
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

export const Monitor = mongoose.models.Monitor || mongoose.model('Monitor', monitorSchema);
