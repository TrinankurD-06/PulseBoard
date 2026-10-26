import mongoose from 'mongoose';
import { baseOptions } from './_options.js';

// A refresh-token session. Only a SHA-256 hash of the token is stored, so a
// database leak does not leak usable refresh tokens. All tokens issued by
// rotating from the same login share a familyId; reuse of an already-rotated
// token revokes the whole family (theft detection).
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 300 },
  },
  baseOptions,
);

sessionSchema.index({ familyId: 1 });
// TTL index: MongoDB deletes sessions automatically once expiresAt has passed.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
