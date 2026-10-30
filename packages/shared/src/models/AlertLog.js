import mongoose from 'mongoose';
import { ALERT_CHANNEL_TYPES } from '../constants.js';

// One row per alert delivery attempt (written by the worker), for the admin overview and the system
// health page. No addresses, webhook URLs or message bodies: just what happened. Kept 90 days.
const alertLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    channelType: { type: String, enum: ALERT_CHANNEL_TYPES, required: true },
    ok: { type: Boolean, required: true },
    error: { type: String, maxlength: 300, default: null },
    incidentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { versionKey: false },
);

alertLogSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
alertLogSchema.index({ ok: 1, at: -1 });

export const AlertLog = mongoose.models.AlertLog || mongoose.model('AlertLog', alertLogSchema);
