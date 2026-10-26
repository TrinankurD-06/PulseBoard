import mongoose from 'mongoose';
import { ROLES } from '../constants.js';
import { baseOptions } from './_options.js';

const membershipSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: Object.values(ROLES), required: true },
  },
  baseOptions,
);

// One membership per user per workspace; also serves the RBAC lookup (wid + uid).
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
// "Which workspaces am I in?" (workspace switcher, socket room joins).
membershipSchema.index({ userId: 1 });

export const Membership =
  mongoose.models.Membership || mongoose.model('Membership', membershipSchema);
