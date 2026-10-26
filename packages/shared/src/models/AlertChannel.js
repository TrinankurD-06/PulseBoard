import mongoose from 'mongoose';
import { ALERT_CHANNEL_TYPES } from '../constants.js';
import { baseOptions } from './_options.js';

const alertChannelSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, trim: true, maxlength: 80 },
    type: { type: String, enum: ALERT_CHANNEL_TYPES, required: true },
    target: { type: String, required: true, trim: true }, // email address or webhook URL
    isEnabled: { type: Boolean, default: true },
  },
  baseOptions,
);

// "Enabled channels of this workspace": read on every incident open/resolve.
alertChannelSchema.index({ workspaceId: 1, isEnabled: 1 });

export const AlertChannel =
  mongoose.models.AlertChannel || mongoose.model('AlertChannel', alertChannelSchema);
