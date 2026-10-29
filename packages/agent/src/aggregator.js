import { createReservoir, percentile } from './stats.js';

export const OTHER_ROUTE = 'other';
export const UNMATCHED_ROUTE = 'unmatched';
const ROUTE_SAMPLE_CAP = 500; // per-route latency samples (bounded too)
const MAX_ROUTE_LENGTH = 300;
const TOP_ROUTES = 10; // routes included in a report

// req.baseUrl is the *matched* mount path, so a router mounted at
// "/users/:id" yields "/users/42". Segments that look like ids are masked so a
// parameterised mount point can't leak them.
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[\w-]{32,})$/i;

function maskIds(base) {
  return base
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
}

/**
 * The route *pattern* of a request, never the concrete URL: "/api/orders/:id",
 * not "/api/orders/8131?token=…". Express sets req.route when a route matched;
 * anything else (404s, static files, middleware-only responses) is "unmatched".
 */
export function routeOf(req) {
  const path = req?.route?.path;
  if (path == null) return UNMATCHED_ROUTE;
  const pattern = typeof path === 'string' ? path : String(path);
  const base = typeof req.baseUrl === 'string' ? maskIds(req.baseUrl) : '';
  if (!base) return pattern;
  return pattern === '/' ? base : `${base}${pattern}`;
}

function newRoute(random) {
  return { requests: 0, errors5xx: 0, latency: createReservoir(ROUTE_SAMPLE_CAP, random) };
}

/**
 * Collects one reporting window at a time. Everything is bounded: at most
 * `maxSamples` latency samples per window and `maxRoutes` distinct routes
 * (further routes are counted under "other").
 */
export function createAggregator({
  maxSamples = 5000,
  maxRoutes = 50,
  random = Math.random,
  now = () => new Date(),
} = {}) {
  let window;

  function reset(start) {
    window = {
      start,
      requests: 0,
      errors5xx: 0,
      errors4xx: 0,
      latency: createReservoir(maxSamples, random),
      routes: new Map(),
    };
  }
  reset(now());

  return {
    /** O(1) per request; never throws on odd input. */
    record({ status, durationMs, route }) {
      const code = Number(status) || 0;
      const ms = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
      window.requests += 1;
      if (code >= 500) window.errors5xx += 1;
      else if (code >= 400) window.errors4xx += 1;
      window.latency.add(ms);

      // The API rejects a whole report holding a route over 300 characters.
      let key = (route || UNMATCHED_ROUTE).slice(0, MAX_ROUTE_LENGTH);
      if (!window.routes.has(key) && window.routes.size >= maxRoutes) key = OTHER_ROUTE;
      let entry = window.routes.get(key);
      if (!entry) {
        entry = newRoute(random);
        window.routes.set(key, entry);
      }
      entry.requests += 1;
      if (code >= 500) entry.errors5xx += 1;
      entry.latency.add(ms);
    },

    /** Closes the current window, starts a new one, and returns the report body. */
    snapshot(end = now()) {
      const closed = window;
      reset(end);
      const sorted = closed.latency.sorted();
      const topRoutes = [...closed.routes.entries()]
        .sort((a, b) => b[1].requests - a[1].requests)
        .slice(0, TOP_ROUTES)
        .map(([route, entry]) => ({
          route,
          requests: entry.requests,
          errors5xx: entry.errors5xx,
          p95Ms: percentile(entry.latency.sorted(), 95),
        }));
      return {
        windowStart: closed.start.toISOString(),
        windowEnd: end.toISOString(),
        requests: closed.requests,
        errors5xx: closed.errors5xx,
        errors4xx: closed.errors4xx,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
        topRoutes,
      };
    },

    /** For tests and diagnostics. */
    get pendingRequests() {
      return window.requests;
    },
    get sampleCount() {
      return window.latency.size;
    },
    get routeCount() {
      return window.routes.size;
    },
  };
}
