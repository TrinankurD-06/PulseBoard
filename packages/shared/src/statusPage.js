import { MONITOR_STATUS } from './constants.js';

export const OVERALL_STATUS = Object.freeze({
  OPERATIONAL: 'operational',
  PARTIAL_OUTAGE: 'partial_outage',
  MAJOR_OUTAGE: 'major_outage',
  NO_DATA: 'no_data',
});

/**
 * The banner at the top of a public status page, from its monitors' statuses.
 * Paused monitors are left out (nobody is checking them); pending ones count
 * as fine (not known to be down), and so do degraded ones (an agent went
 * silent but the endpoint answers). Browser-safe: used by API and client.
 */
export function overallStatus(statuses) {
  const active = statuses.filter((status) => status !== MONITOR_STATUS.PAUSED);
  if (active.length === 0) return OVERALL_STATUS.NO_DATA;
  const down = active.filter((status) => status === MONITOR_STATUS.DOWN).length;
  if (down === 0) return OVERALL_STATUS.OPERATIONAL;
  return down === active.length ? OVERALL_STATUS.MAJOR_OUTAGE : OVERALL_STATUS.PARTIAL_OUTAGE;
}

/**
 * A monitor's status as shown on a public page: 'degraded' (an internal "agent
 * silent, endpoint reachable" state) is shown as up.
 */
export const publicMonitorStatus = (status) =>
  status === MONITOR_STATUS.DEGRADED ? MONITOR_STATUS.UP : status;
