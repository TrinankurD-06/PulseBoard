export const AGENT_VERSION = '1.0.0';
export const MIN_REPORT_SEC = 30;
export const MAX_REPORT_SEC = 300;
export const DEFAULT_REPORT_SEC = 60;
export const REQUEST_TIMEOUT_MS = 5000;

const PREFIX = '[pulseboard-agent]';

const fail = (message) => new TypeError(`${PREFIX} ${message}`);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Validates the API base URL and returns it without trailing slashes. */
export function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw fail(
      'endpoint is required: your PulseBoard API base URL, e.g. "https://your-pulseboard.example.com/api/v1".',
    );
  }
  let url;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw fail(`endpoint "${endpoint}" is not a valid URL (expected https://host/api/v1).`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw fail(`endpoint must start with http:// or https:// (got "${url.protocol}").`);
  }
  return url.href.replace(/\/+$/, '');
}

export function normalizeApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw fail(
      'apiKey is required: the agent key from your PulseBoard monitor. If you read it from an environment variable (process.env.PULSEBOARD_KEY), check that the variable is set.',
    );
  }
  return apiKey.trim();
}

/**
 * Validates and normalises the options of pulseboard(). Misconfiguration is a
 * programming error and fails fast at start-up with a clear message; nothing
 * here runs per request.
 */
export function resolveOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw fail('options must be an object: pulseboard({ apiKey, endpoint }).');
  }
  const {
    enabled = true,
    apiKey,
    endpoint,
    intervalSec,
    reportEverySec,
    serviceName,
    debug = false,
    logger = console,
    maxRoutes = 50,
    maxSamples = 5000,
    handleSignals = true,
    fetch: fetchImpl = globalThis.fetch,
    now = () => new Date(),
    random = Math.random,
    kill = (pid, signal) => process.kill(pid, signal),
  } = options;

  if (enabled === false) return { enabled: false };

  const rawInterval = intervalSec ?? reportEverySec ?? DEFAULT_REPORT_SEC;
  if (typeof rawInterval !== 'number' || !Number.isFinite(rawInterval) || rawInterval <= 0) {
    throw fail(
      `intervalSec must be a positive number of seconds (got ${JSON.stringify(rawInterval)}).`,
    );
  }
  if (serviceName != null && (typeof serviceName !== 'string' || serviceName.length > 100)) {
    throw fail('serviceName must be a string of at most 100 characters.');
  }
  if (typeof fetchImpl !== 'function') {
    throw fail('fetch is not available: Node.js 18 or newer is required.');
  }

  return {
    enabled: true,
    apiKey: normalizeApiKey(apiKey),
    url: `${normalizeEndpoint(endpoint)}/agent/report`,
    intervalMs: clamp(rawInterval, MIN_REPORT_SEC, MAX_REPORT_SEC) * 1000,
    serviceName: serviceName?.trim() || null,
    debug: debug === true,
    logger,
    maxRoutes,
    maxSamples,
    handleSignals: handleSignals !== false,
    fetchImpl,
    now,
    random,
    kill,
  };
}
