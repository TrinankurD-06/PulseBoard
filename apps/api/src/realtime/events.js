// Pure mapping from MongoDB change events to Socket.io events.

export const roomFor = (workspaceId) => `workspace:${workspaceId}`;

/** Only these monitor fields go to browsers (never headers, which may hold secrets). */
const LIVE_MONITOR_FIELDS = [
  'status',
  'isPaused',
  'lastCheckedAt',
  'lastResponseMs',
  'lastOk',
  'lastStatusCode',
  'lastError',
  'lastTimings',
  'sslExpiresAt',
  // U2: adaptive interval and budget state, so the UI label/banner update live.
  'adaptive',
  'currentIntervalSec',
  'pausedReason',
  'budgetExceededMonth',
];

/** Change-stream filter for monitors: check results, status, interval and budget changes. */
export const MONITOR_PIPELINE = [
  {
    $match: {
      $or: [
        { operationType: 'replace' },
        {
          operationType: 'update',
          $or: [
            { 'updateDescription.updatedFields.lastCheckedAt': { $exists: true } },
            { 'updateDescription.updatedFields.status': { $exists: true } },
            { 'updateDescription.updatedFields.currentIntervalSec': { $exists: true } },
            { 'updateDescription.updatedFields.budgetExceededMonth': { $exists: true } },
          ],
        },
      ],
    },
  },
];

/** Change-stream filter for incidents: creation and any update (resolve, timeline). */
export const INCIDENT_PIPELINE = [
  { $match: { operationType: { $in: ['insert', 'update', 'replace'] } } },
];

export function monitorChangeToEvent(change) {
  const monitor = change.fullDocument;
  if (!monitor) return null; // deleted before the lookup ran
  const payload = { monitorId: String(monitor._id), workspaceId: String(monitor.workspaceId) };
  for (const field of LIVE_MONITOR_FIELDS) payload[field] = monitor[field] ?? null;
  return { room: roomFor(monitor.workspaceId), event: 'check:result', payload };
}

export function incidentChangeToEvent(change) {
  const incident = change.fullDocument;
  if (!incident) return null;

  let event = 'incident:updated'; // e.g. an alert was sent: timeline changed
  if (change.operationType === 'insert') event = 'incident:opened';
  else if (incident.resolvedAt && 'resolvedAt' in (change.updateDescription?.updatedFields ?? {})) {
    event = 'incident:resolved';
  }

  return {
    room: roomFor(incident.workspaceId),
    event,
    payload: {
      id: String(incident._id),
      monitorId: String(incident.monitorId),
      workspaceId: String(incident.workspaceId),
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt ?? null,
      durationSec: incident.durationSec ?? null,
      cause: incident.cause ?? null,
    },
  };
}
