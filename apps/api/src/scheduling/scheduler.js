/**
 * The API's view of job scheduling. Services only call these two methods, so
 * they don't care whether jobs go to Agenda (production, phase 4), a fake that
 * records calls (tests), or nowhere at all.
 *
 *   scheduleMonitor(monitor): create or update the repeating check job
 *   cancelMonitor(monitorId): remove the monitor's job
 */
export const noopScheduler = {
  async scheduleMonitor() {},
  async cancelMonitor() {},
};
