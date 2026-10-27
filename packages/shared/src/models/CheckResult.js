import mongoose from 'mongoose';
import { CHECK_RESULT_TTL_SEC, CHECK_SOURCES } from '../constants.js';
import { timingsSchema } from './Monitor.js';

// Stored in a MongoDB time-series collection: documents are bucketed by
// meta (monitor) and time internally, which compresses well and makes
// range queries per monitor cheap. Old data expires automatically after 7 days.
const checkResultSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    meta: {
      monitorId: { type: mongoose.Schema.Types.ObjectId, required: true },
      workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    },
    ok: { type: Boolean, required: true },
    statusCode: { type: Number, default: null },
    error: { type: String, default: null },
    totalMs: { type: Number, default: null },
    timings: { type: timingsSchema, default: null },
    // Where it came from: a scheduled check, a heartbeat ping, an agent report...
    // Older results have no source and are http checks.
    source: { type: String, enum: Object.values(CHECK_SOURCES), default: CHECK_SOURCES.HTTP },
  },
  {
    versionKey: false,
    timeseries: { timeField: 'timestamp', metaField: 'meta', granularity: 'seconds' },
    expireAfterSeconds: CHECK_RESULT_TTL_SEC,
  },
);

// Secondary index for "checks of monitor X between from and to".
checkResultSchema.index({ 'meta.monitorId': 1, timestamp: -1 });
// Dashboard sparklines: recent checks of every monitor in a workspace.
checkResultSchema.index({ 'meta.workspaceId': 1, timestamp: -1 });

export const CheckResult =
  mongoose.models.CheckResult || mongoose.model('CheckResult', checkResultSchema, 'checkresults');
