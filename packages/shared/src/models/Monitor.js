import mongoose from 'mongoose';
import {
  DEFAULT_EXPECTED_STATUS,
  DEFAULT_TIMEOUT_MS,
  HTTP_METHODS,
  MONITOR_STATUS,
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
    isPaused: { type: Boolean, default: false },
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
