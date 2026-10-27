import mongoose from 'mongoose';
import { baseOptions } from './_options.js';

const dailyRollupSchema = new mongoose.Schema(
  {
    monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    date: { type: Date, required: true }, // midnight UTC of the day
    totalChecks: { type: Number, default: 0 },
    upChecks: { type: Number, default: 0 },
    avgResponseMs: { type: Number, default: null },
    p95ResponseMs: { type: Number, default: null },
    downtimeSec: { type: Number, default: 0 },
    isFinal: { type: Boolean, default: false },
    // Seconds of this day the monitor was being watched (first result to the end of the day, or to now).
    // Uptime = 1 - downtimeSec / coveredSec. Missing on older rows: see uptime/index.js.
    coveredSec: { type: Number, default: null },
    // Created by `npm run seed` as sample data; `npm run seed:clear` deletes these.
    isSeed: { type: Boolean, default: false },
  },
  baseOptions,
);

// One row per monitor per day; also the $merge "on" key and the 90-day bar query.
dailyRollupSchema.index({ monitorId: 1, date: 1 }, { unique: true });

export const DailyRollup =
  mongoose.models.DailyRollup || mongoose.model('DailyRollup', dailyRollupSchema);
