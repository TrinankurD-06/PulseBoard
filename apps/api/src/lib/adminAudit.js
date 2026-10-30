import { AdminAuditLog } from '@pulseboard/shared/models';

const DEDUPE_MS = 10 * 60 * 1000;

/** The client address as the app sees it (behind a proxy: only if TRUST_PROXY is on). */
export const clientIp = (req) => req.ip ?? null;

/**
 * Appends one row to the admin audit log. Awaited by callers: an administrator action whose log
 * entry cannot be written must not go ahead, so a failure here propagates.
 *
 * `before` / `after` are small summaries (a status, a role, a count), never whole documents and
 * never secrets.
 */
export function recordAudit(
  req,
  { action, targetType, targetId, before, after, note },
  { admin = req.admin } = {},
) {
  return AdminAuditLog.create({
    adminId: admin.id,
    adminEmail: admin.email,
    action,
    targetType,
    targetId: String(targetId),
    summary: { before, after, note },
    ip: clientIp(req),
  });
}

/**
 * Like recordAudit, but writes nothing if the same admin did the same thing to the same target in
 * the last 10 minutes (opening ten pages of one workspace is one "view", not ten rows).
 */
export async function recordAuditOnce(req, entry, options = {}) {
  const admin = options.admin ?? req.admin;
  const recent = await AdminAuditLog.exists({
    adminId: admin.id,
    action: entry.action,
    targetType: entry.targetType,
    targetId: String(entry.targetId),
    at: { $gte: new Date(Date.now() - DEDUPE_MS) },
  });
  if (!recent) await recordAudit(req, entry, { admin });
}
