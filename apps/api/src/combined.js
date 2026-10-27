import os from 'node:os';

/**
 * RUN_MODE=combined: run the worker (Agenda job handlers, boot-time
 * reconciliation, recurring rollups, alerts) inside this API process, so a
 * single web service does everything. Returns the running worker, or null in
 * the default "api" mode.
 *
 * The worker code is loaded on demand, so an API-only process never pays for it.
 * `loadWorker` is injectable for tests. Call after MongoDB is connected.
 */
export async function startCombinedWorker({
  env,
  logger,
  loadWorker = () => import('@pulseboard/worker/start'),
}) {
  if (env.RUN_MODE !== 'combined') return null;
  const { startWorker } = await loadWorker();
  return startWorker({
    env,
    logger: logger.child({ role: 'worker' }),
    agendaName: `combined-${os.hostname()}-${process.pid}`,
  });
}
