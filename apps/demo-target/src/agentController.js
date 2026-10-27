import { pulseboard } from 'pulseboard-agent';

/**
 * Owns the demo's pulseboard-agent instance so the control page can stop it
 * ("agent silent", "crash") and start a fresh one ("restore"). `middleware`
 * is stable: Express mounts it once and it forwards to the current instance.
 *
 * state: 'off' (no agent key) | 'reporting' | 'stopped'.
 */
export function createAgentController({
  config,
  createAgent = pulseboard,
  logger = console,
  now = () => new Date(),
} = {}) {
  let instance = null;
  let state = 'off';
  let since = now();

  function start() {
    if (!config || instance) return;
    instance = createAgent({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      reportEverySec: config.reportEverySec,
      logger,
    });
    state = 'reporting';
    since = now();
  }

  /** Stops reporting without a last report, like a process that died. */
  async function stop() {
    if (!instance) return;
    const current = instance;
    instance = null;
    state = 'stopped';
    since = now();
    await current.stop({ flush: false });
  }

  async function restart() {
    await stop();
    start();
  }

  /**
   * New settings (e.g. the seed wrote a new key). A running agent restarts
   * with them; one stopped by a scenario stays stopped until "restore".
   */
  async function configure(next) {
    const wasStopped = state === 'stopped';
    await stop();
    config = next;
    if (!config) {
      state = 'off';
      since = now();
    } else if (!wasStopped) {
      start();
    }
  }

  function middleware(req, res, next) {
    if (instance) return instance(req, res, next);
    return next();
  }

  function status() {
    return {
      state,
      since,
      reportEverySec: config?.reportEverySec ?? null,
      endpoint: config?.endpoint ?? null,
      source: config?.source ?? null,
    };
  }

  start();
  return {
    middleware,
    start,
    stop,
    restart,
    configure,
    status,
    isReporting: () => state === 'reporting',
  };
}
