import { DailyRollup, Incident, Monitor, StatusPage } from '@pulseboard/shared/models';
import { overallStatus, publicMonitorStatus } from '@pulseboard/shared/statusPage';
import {
  addDays,
  combineRollups,
  DAY_MS,
  fillDailySeries,
  utcDayStart,
} from '@pulseboard/shared/uptime';

const DAYS = 90;
const INCIDENT_WINDOW_DAYS = 30;
const MAX_INCIDENTS = 20;

/**
 * Builds the public payload for /status/:slug, or null if there is no PUBLIC
 * page with that slug (a private page looks exactly like a missing one).
 *
 * This is a whitelist: only what's written here leaves the API. In particular
 * no monitor URLs (could be internal hosts), ids, workspace ids, headers or
 * error messages (could reveal infrastructure details).
 */
export async function buildPublicStatus(slug, now = new Date()) {
  const page = await StatusPage.findOne({ slug, isPublic: true }).lean();
  if (!page) return null;

  const found = await Monitor.find(
    { _id: { $in: page.monitorIds }, workspaceId: page.workspaceId },
    { name: 1, status: 1 },
  ).lean();
  // Keep the order the owner chose on the page.
  const monitors = page.monitorIds
    .map((id) => found.find((monitor) => monitor._id.equals(id)))
    .filter(Boolean);
  const ids = monitors.map((monitor) => monitor._id);

  const [rollups, incidents] = await Promise.all([
    DailyRollup.find(
      { monitorId: { $in: ids }, date: { $gte: addDays(utcDayStart(now), 1 - DAYS) } },
      { monitorId: 1, date: 1, totalChecks: 1, upChecks: 1, downtimeSec: 1 },
    ).lean(),
    Incident.find(
      {
        monitorId: { $in: ids },
        startedAt: { $gte: new Date(now - INCIDENT_WINDOW_DAYS * DAY_MS) },
      },
      { monitorId: 1, startedAt: 1, resolvedAt: 1, durationSec: 1 },
    )
      .sort({ startedAt: -1 })
      .limit(MAX_INCIDENTS)
      .lean(),
  ]);

  const nameOf = new Map(monitors.map((monitor) => [String(monitor._id), monitor.name]));

  return {
    title: page.title,
    description: page.description ?? '',
    overall: overallStatus(monitors.map((monitor) => monitor.status)),
    monitors: monitors.map((monitor) => {
      const own = rollups.filter((rollup) => rollup.monitorId.equals(monitor._id));
      return {
        name: monitor.name,
        status: publicMonitorStatus(monitor.status),
        uptime90: combineRollups(own).uptime,
        days: fillDailySeries(own, { days: DAYS, today: now }).map(
          ({ date, uptime, downtimeSec, totalChecks }) => ({
            date,
            uptime,
            downtimeSec,
            totalChecks,
          }),
        ),
      };
    }),
    incidents: incidents.map((incident) => ({
      monitorName: nameOf.get(String(incident.monitorId)),
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt ?? null,
      durationSec: incident.durationSec ?? null,
    })),
    generatedAt: now,
  };
}
