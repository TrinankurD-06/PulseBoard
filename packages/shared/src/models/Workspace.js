import mongoose from 'mongoose';
import { baseOptions } from './_options.js';

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Set by an administrator: members get 403 WORKSPACE_SUSPENDED and its monitors are paused.
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, trim: true, maxlength: 300, default: null },
  },
  baseOptions,
);

export const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', workspaceSchema);
