import { INCIDENT_EVENT } from '../constants.js';
import { Incident } from '../models/Incident.js';

const MAX_MESSAGE = 500;
export const truncate = (text) =>
  text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;

/**
 * Opens an incident for a monitor. Returns null if one is already open: the
 * partial unique index (one open incident per monitor) rejects the insert, so
 * even a race between two workers can't create a duplicate.
 */
export async function openIncident(monitor, { startedAt, cause, openedAt, message }) {
  try {
    return await Incident.create({
      monitorId: monitor._id,
      workspaceId: monitor.workspaceId,
      startedAt,
      cause: cause ? truncate(cause) : 'Unknown',
      timeline: [{ at: openedAt, type: INCIDENT_EVENT.OPENED, message: truncate(message) }],
    });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

/**
 * Resolves the monitor's open incident (if any) and returns it, or null if
 * there was none. The `resolvedAt: null` filter makes this safe to call
 * concurrently: only one caller resolves it.
 */
export async function resolveOpenIncident(monitorId, { resolvedAt, message, at = resolvedAt }) {
  const open = await Incident.findOne({ monitorId, resolvedAt: null }, { startedAt: 1 }).lean();
  if (!open) return null;
  const durationSec = Math.max(0, Math.round((resolvedAt - open.startedAt) / 1000));
  return Incident.findOneAndUpdate(
    { _id: open._id, resolvedAt: null },
    {
      $set: { resolvedAt, durationSec },
      $push: { timeline: { at, type: INCIDENT_EVENT.RESOLVED, message: truncate(message) } },
    },
    { returnDocument: 'after' },
  ).lean();
}

/** Appends a timeline entry (alert sent/failed). */
export function addTimelineEntry(incidentId, { type, message, at = new Date() }, extra = {}) {
  return Incident.updateOne(
    { _id: incidentId },
    { $push: { timeline: { at, type, message: truncate(message) } }, ...extra },
  );
}
