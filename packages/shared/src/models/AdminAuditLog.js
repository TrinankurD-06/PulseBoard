import mongoose from 'mongoose';

// Every administrator write, and every read of a user's, workspace's, monitor's or incident's
// detail. Append-only: nothing in the app updates or deletes these. Kept 2 years.
const auditSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    adminEmail: { type: String, required: true },
    action: { type: String, required: true }, // 'user.suspend', 'monitor.read', ...
    targetType: {
      type: String,
      enum: ['user', 'workspace', 'monitor', 'incident'],
      required: true,
    },
    targetId: { type: String, required: true },
    // Short, human summaries only: never secrets, never whole documents.
    summary: {
      before: { type: mongoose.Schema.Types.Mixed, default: undefined },
      after: { type: mongoose.Schema.Types.Mixed, default: undefined },
      note: { type: String, maxlength: 500, default: undefined },
    },
    ip: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

auditSchema.index({ at: -1 });
auditSchema.index({ adminId: 1, at: -1 });
auditSchema.index({ action: 1, at: -1 });
auditSchema.index({ targetType: 1, targetId: 1, at: -1 });
auditSchema.index({ at: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 60 * 60 });

auditSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

export const AdminAuditLog =
  mongoose.models.AdminAuditLog || mongoose.model('AdminAuditLog', auditSchema);
