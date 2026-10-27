import os from 'node:os';
import { createAggregator, routeOf } from './aggregator.js';

export { createAggregator, routeOf } from './aggregator.js';
export { createReservoir, percentile } from './stats.js';

export const AGENT_VERSION = '1.0.0';
export const MIN_REPORT_SEC = 30;
export const MAX_REPORT_SEC = 300;
const REQUEST_TIMEOUT_MS = 5000;
const SHUTDOWN_TIMEOUT_MS = 2000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
 * - adds no awaited work to requests (recording is synchronous and O(1));
 * - never throws into the host app (misconfiguration logs a warning and the
 *   middleware becomes a pass-through);
 * - sends a report every window even with zero traffic (a heartbeat: silence
 *   means the app is down);
 * - if PulseBoard can't be reached, that window is dropped with one warning;
 *   memory stays bounded.
 *
 * Returns the middleware function, with `flush()` (send now) and `stop()`
 * (stop the timer and signal handler, flushing the last window by default).
 */
export function pulseboard(options = {}) {
  const {
    apiKey,
    endpoint,
    reportEverySec = 60,
    enabled = true,
    logger = console,
    maxRoutes = 50,
    maxSamples = 5000,
    handleSignals = true,
    // Advanced / testing hooks (not part of the documented options).
    fetch: fetchImpl = globalThis.fetch,
    now = () => new Date(),
    random = Math.random,
    kill = (pid, signal) => process.kill(pid, signal),
  } = options;

  const warn = (message) => {
    try {
      logger?.warn?.(`[pulseboard-agent] ${message}`);
    } catch {
      // A broken logger must never break the host app.
    }
  };

  const disabled = (reason) => {
    if (reason) warn(`${reason}; the agent is disabled.`);
    const middleware = (req, res, next) => noopMiddleware(req, res, next);
    middleware.flush = async () => false;
    middleware.stop = async () => {};
    return middleware;
  };

  if (!enabled) return disabled();
  if (!apiKey) return disabled('No apiKey given');
  if (!endpoint) return disabled('No endpoint given');
  if (typeof fetchImpl !== 'function')
    return disabled('fetch is not available (Node 18+ required)');

  const url = `${String(endpoint).replace(/\/+$/, '')}/agent/report`;
  const intervalMs = clamp(Number(reportEverySec) || 60, MIN_REPORT_SEC, MAX_REPORT_SEC) * 1000;
  const aggregator = createAggregator({ maxSamples, maxRoutes, random, now });
  let stopped = false;

  /** Sends the current window. Resolves true on success, false otherwise; never rejects. */
  async function flush({ timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    let body;
    try {
      body = {
        ...aggregator.snapshot(now()),
        agentVersion: AGENT_VERSION,
        hostname: os.hostname(),
        uptimeSec: Math.round(process.uptime()),
      };
    } catch (err) {
      warn(`Could not build the report (${err?.message ?? err}); window dropped.`);
      return false;
    }
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'user-agent': `pulseboard-agent/${AGENT_VERSION}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        warn(`PulseBoard answered HTTP ${res.status}; this window's report was dropped.`);
        return false;
      }
      return true;
    } catch (err) {
      warn(
        `Could not reach PulseBoard (${err?.message ?? err}); this window's report was dropped.`,
      );
      return false;
    }
  }

  const timer = setInterval(() => {
    void flush();
  }, intervalMs);
  timer.unref?.();

  // SIGTERM: send what we have, best effort. We never call process.exit: if
  // nobody else listens for SIGTERM, adding our listener would otherwise stop
  // Node's default "terminate", so we re-raise the signal after flushing.
  async function onSigterm() {
    process.removeListener('SIGTERM', onSigterm);
    clearInterval(timer);
    await flush({ timeoutMs: SHUTDOWN_TIMEOUT_MS });
    if (process.listenerCount('SIGTERM') === 0) {
      try {
        kill(process.pid, 'SIGTERM');
      } catch {
        // Nothing sensible to do: the host is shutting down anyway.
      }
    }
  }
  if (handleSignals) process.on('SIGTERM', onSigterm);

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
    clearInterval(timer);
    process.removeListener('SIGTERM', onSigterm);
    if (flushLast) await flush();
  };
  return middleware;
}

export default pulseboard;
