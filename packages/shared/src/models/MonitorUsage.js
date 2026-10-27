import mongoose from 'mongoose';
import { baseOptions } from './_options.js';

// Requests PulseBoard actually sent to a monitor's endpoint, per calendar month
// (UTC). One small document per monitor per month, bumped with $inc after
// every check: far cheaper than counting the time-series collection.
const monitorUsageSchema = new mongoose.Schema(
  {
    monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    month: { type: String, required: true }, // "YYYY-MM"
    requests: { type: Number, default: 0 },
    // Heartbeat pings received (requests that came TO us instead of FROM us).
    pings: { type: Number, default: 0 },
    // Agent reports received (U4).
    reports: { type: Number, default: 0 },
    // "Sent once per month" markers for budget notices, set atomically (only if null).
    warnedAt: { type: Date, default: null },
    exceededAt: { type: Date, default: null },
    // Created by `npm run seed` as sample data; `npm run seed:clear` deletes these.
    isSeed: { type: Boolean, default: false },
  },
  baseOptions,
);

// One row per monitor per month; also the upsert key for the $inc.
monitorUsageSchema.index({ monitorId: 1, month: 1 }, { unique: true });
// Cost & Usage page: all monitors of a workspace for a month.
monitorUsageSchema.index({ workspaceId: 1, month: 1 });

export const MonitorUsage =
  mongoose.models.MonitorUsage || mongoose.model('MonitorUsage', monitorUsageSchema);
