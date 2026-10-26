import mongoose from 'mongoose';
import { baseOptions } from './_options.js';

const statusPageSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    monitorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Monitor' }],
    isPublic: { type: Boolean, default: true },
  },
  baseOptions,
);

statusPageSchema.index({ workspaceId: 1 });

export const StatusPage =
  mongoose.models.StatusPage || mongoose.model('StatusPage', statusPageSchema);
