import mongoose from 'mongoose';

// Unexpected server errors (HTTP 500), for the admin system health page. The route is the route
// PATTERN, never the URL with ids or a query string; no request bodies, headers or users. 14 days.
const errorLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    method: { type: String, maxlength: 10 },
    route: { type: String, maxlength: 200 },
    status: { type: Number },
    code: { type: String, maxlength: 60 },
    message: { type: String, maxlength: 300 },
  },
  { versionKey: false },
);

errorLogSchema.index({ at: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

export const ErrorLog = mongoose.models.ErrorLog || mongoose.model('ErrorLog', errorLogSchema);
