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
  },
  baseOptions,
);

// One row per monitor per day; also the $merge "on" key and the 90-day bar query.
dailyRollupSchema.index({ monitorId: 1, date: 1 }, { unique: true });

export const DailyRollup =
  mongoose.models.DailyRollup || mongoose.model('DailyRollup', dailyRollupSchema);
