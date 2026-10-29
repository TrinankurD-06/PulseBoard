import { normalizeApiKey, normalizeEndpoint } from './options.js';
import { postReport, reportExtras } from './send.js';

const HEARTBEAT_WINDOW_MS = 60 * 1000;

/**
 * Sends one empty report ("I'm alive, no traffic") for processes that can't run
 * the middleware: cron jobs, scripts and serverless functions.
 *
 *   await heartbeat(process.env.PULSEBOARD_KEY, 'https://…/api/v1');
 *
 * Throws only for a missing or malformed apiKey / endpoint. Once running it
 * never rejects: it resolves `true` when PulseBoard accepted the report and
 * `false` otherwise (no retry; call it again on the next run).
 */
export function heartbeat(apiKey, endpoint, options = {}) {
  const key = normalizeApiKey(apiKey);
  const url = `${normalizeEndpoint(endpoint)}/agent/report`;
  const {
    serviceName,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs,
    now = () => new Date(),
  } = options ?? {};
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      '[pulseboard-agent] fetch is not available: Node.js 18 or newer is required.',
    );
  }

  const end = now();
  const body = {
    windowStart: new Date(end.getTime() - HEARTBEAT_WINDOW_MS).toISOString(),
    windowEnd: end.toISOString(),
    requests: 0,
    errors5xx: 0,
    errors4xx: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    topRoutes: [],
    ...reportExtras(serviceName?.trim()),
  };
  return postReport({ url, apiKey: key, body, fetchImpl, timeoutMs }).then((result) => result.ok);
}
