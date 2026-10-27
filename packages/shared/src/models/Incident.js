import mongoose from 'mongoose';
import { INCIDENT_EVENT } from '../constants.js';
import { baseOptions } from './_options.js';

const timelineEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, enum: Object.values(INCIDENT_EVENT), required: true },
    message: { type: String, maxlength: 500 },
    // The failure's machine-readable code (on the 'opened' entry).
    code: { type: String, default: null },
  },
  { _id: false },
);

const incidentSchema = new mongoose.Schema(
  {
    monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    startedAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    cause: { type: String, maxlength: 500 },
    causeCode: { type: String, default: null },
    // Created by `npm run seed` as sample data; `npm run seed:clear` deletes these.
    isSeed: { type: Boolean, default: false },
    durationSec: { type: Number, default: null },
    timeline: { type: [timelineEntrySchema], default: [] },
    // "channelId:kind" keys of alerts already delivered, so a retried or
    // duplicated send-alert job never notifies the same channel twice.
    deliveredAlerts: { type: [String], default: [] },
  },
  baseOptions,
);

// Incidents page: open/resolved per workspace, newest first.
incidentSchema.index({ workspaceId: 1, resolvedAt: 1, startedAt: -1 });
// Monitor detail page + status page "recent incidents".
incidentSchema.index({ monitorId: 1, startedAt: -1 });
// Safety net: at most ONE open incident per monitor, enforced by the database.
incidentSchema.index(
  { monitorId: 1 },
  { unique: true, partialFilterExpression: { resolvedAt: { $type: 'null' } } },
);

export const Incident = mongoose.models.Incident || mongoose.model('Incident', incidentSchema);
