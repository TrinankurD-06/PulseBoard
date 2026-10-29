import { createAggregator, routeOf } from './aggregator.js';
import { resolveOptions } from './options.js';
import { postReport, reportExtras } from './send.js';

export { createAggregator, routeOf } from './aggregator.js';
export { heartbeat } from './heartbeat.js';
export { AGENT_VERSION, MAX_REPORT_SEC, MIN_REPORT_SEC } from './options.js';
export { createReservoir, percentile } from './stats.js';

const SHUTDOWN_TIMEOUT_MS = 2000;

function noopMiddleware(_req, _res, next) {
  next();
}

/**
 * Creates the PulseBoard agent: an Express middleware that measures every
 * request and sends ONE aggregated report per window to PulseBoard.
 *
 *   app.use(pulseboard({ apiKey: process.env.PULSEBOARD_KEY, endpoint: 'https://…/api/v1' }));
 *
 * Guarantees:
 * - bad options throw a clear error at start-up (a missing apiKey is a bug to
 *   find at boot, not at 3 a.m.); after that nothing throws into the host app;
 * - adds no awaited work to requests (recording is synchronous and O(1));
 * - sends a report every window even with zero traffic (a heartbeat: silence
 *   means the app is down);
 * - if PulseBoard can't be reached, that window is dropped, one warning is
 *   logged per outage, and memory stays bounded.
 *
 * Returns the middleware function, with `flush()` (send now) and `stop()`
 * (stop the timer and signal handlers, flushing the last window by default).
 */
export function pulseboard(options = {}) {
  const config = resolveOptions(options);

  if (!config.enabled) {
    const middleware = (req, res, next) => noopMiddleware(req, res, next);
    middleware.flush = async () => false;
    middleware.stop = async () => {};
    return middleware;
  }

  const { apiKey, url, intervalMs, serviceName, debug, logger, fetchImpl, now, kill } = config;
  const aggregator = createAggregator({
    maxSamples: config.maxSamples,
    maxRoutes: config.maxRoutes,
    random: config.random,
    now,
  });
  let stopped = false;
  let failing = false; // inside an outage: warned already, stay quiet until it recovers

  const log = (level, message) => {
    try {
      logger?.[level]?.(`[pulseboard-agent] ${message}`);
    } catch {
      // A broken logger must never break the host app.
    }
  };

  /** Sends the current window. Resolves true on success, false otherwise; never rejects. */
  async function flush({ timeoutMs } = {}) {
    let body;
    try {
      body = { ...aggregator.snapshot(now()), ...reportExtras(serviceName) };
    } catch (err) {
      log('warn', `Could not build the report (${err?.message ?? err}); window dropped.`);
      return false;
    }
    const result = await postReport({ url, apiKey, body, fetchImpl, timeoutMs });
    if (!result.ok) {
      if (!failing) {
        log('warn', `${result.reason}; this window's report was dropped. Retrying next window.`);
      } else if (debug) {
        log('info', `report dropped: ${result.reason}`);
      }
      failing = true;
      return false;
    }
    if (failing) log('info', 'Reports are reaching PulseBoard again.');
    failing = false;
    if (debug) {
      log('info', `report sent: ${body.requests} requests, ${body.topRoutes.length} routes.`);
    }
    return true;
  }

  const timer = setInterval(() => {
    void flush();
  }, intervalMs);
  timer.unref?.();

  function detach() {
    clearInterval(timer);
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('beforeExit', onBeforeExit);
  }

  // SIGTERM: send what we have, best effort. We never call process.exit: if
  // nobody else listens for SIGTERM, adding our listener would otherwise stop
  // Node's default "terminate", so we re-raise the signal after flushing.
  async function onSigterm() {
    detach();
    await flush({ timeoutMs: SHUTDOWN_TIMEOUT_MS });
    if (process.listenerCount('SIGTERM') === 0) {
      try {
        kill(process.pid, 'SIGTERM');
      } catch {
        // Nothing sensible to do: the host is shutting down anyway.
      }
    }
  }

  // beforeExit: the event loop is empty (a script finished, a server closed).
  // Send the last window once; the listener is removed first so the exit isn't
  // postponed a second time.
  async function onBeforeExit() {
    detach();
    await flush({ timeoutMs: SHUTDOWN_TIMEOUT_MS });
  }

  if (config.handleSignals) {
    process.on('SIGTERM', onSigterm);
    process.on('beforeExit', onBeforeExit);
  }

  function middleware(req, res, next) {
    if (!stopped) {
      try {
        const start = process.hrtime.bigint();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try {
            aggregator.record({
              status: res.statusCode,
              durationMs: Number(process.hrtime.bigint() - start) / 1e6,
              route: routeOf(req),
            });
          } catch {
            // Measuring must never affect the response.
          }
        };
        res.once?.('finish', finish);
        res.once?.('close', finish);
      } catch {
        // Unusual req/res objects: just don't measure this request.
      }
    }
    next();
  }

  middleware.flush = () => flush();
  middleware.stop = async ({ flush: flushLast = true } = {}) => {
    if (stopped) return;
    stopped = true;
    detach();
    if (flushLast) await flush();
  };
  return middleware;
}

export default pulseboard;
