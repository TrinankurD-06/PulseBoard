import mongoose from 'mongoose';
import { baseOptions } from './_options.js';

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  baseOptions,
);

export const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', workspaceSchema);
