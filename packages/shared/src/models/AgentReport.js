import mongoose from 'mongoose';
import { CHECK_RESULT_TTL_SEC } from '../constants.js';

const routeSchema = new mongoose.Schema(
  {
    route: String,
    requests: Number,
    errors5xx: Number,
    p95Ms: { type: Number, default: null },
  },
  { _id: false },
);

// One aggregated window from an agent (U4), in a time-series collection like
// CheckResult. Kept 7 days; the agent-metrics endpoint charts it.
const agentReportSchema = new mongoose.Schema(
  {
    windowEnd: { type: Date, required: true },
    meta: {
      monitorId: { type: mongoose.Schema.Types.ObjectId, required: true },
      workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    },
    windowStart: { type: Date, required: true },
    requests: { type: Number, required: true },
    errors5xx: { type: Number, required: true },
    errors4xx: { type: Number, required: true },
    p50Ms: { type: Number, default: null },
    p95Ms: { type: Number, default: null },
    p99Ms: { type: Number, default: null },
    topRoutes: { type: [routeSchema], default: [] },
    agentVersion: { type: String, default: null },
    hostname: { type: String, default: null },
    serviceName: { type: String, default: null },
    uptimeSec: { type: Number, default: null },
    // Created by `npm run seed` as sample data; `npm run seed:clear` deletes these.
    isSeed: { type: Boolean, default: false },
  },
  {
    versionKey: false,
    timeseries: { timeField: 'windowEnd', metaField: 'meta', granularity: 'seconds' },
    expireAfterSeconds: CHECK_RESULT_TTL_SEC,
  },
);

agentReportSchema.index({ 'meta.monitorId': 1, windowEnd: -1 });

export const AgentReport =
  mongoose.models.AgentReport || mongoose.model('AgentReport', agentReportSchema, 'agentreports');
