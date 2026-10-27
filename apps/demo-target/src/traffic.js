// A little internal traffic so the agent's charts move during a demo without
// a load generator: about one request a second to the site's own routes, with
// the occasional 404 for a realistic 4xx count.
export const TRAFFIC_ROUTES = ['/', '/api/products', '/api/orders/:id'];

/** The path for the n-th background request. */
export function trafficPath(n, random = Math.random) {
  if (n % 25 === 24) return '/api/orders/unknown';
  const route = TRAFFIC_ROUTES[n % TRAFFIC_ROUTES.length];
  return route.replace(':id', String(1000 + Math.floor(random() * 9000)));
}

/**
 * Sends one request every `everyMs` to `baseUrl`. Failures (crash mode drops
 * connections) are ignored. Returns `stop()`.
 */
export function startBackgroundTraffic({
  baseUrl,
  everyMs = 1000,
  fetch: fetchImpl = globalThis.fetch,
  random = Math.random,
}) {
  let n = 0;
  const timer = setInterval(() => {
    const path = trafficPath(n, random);
    n += 1;
    fetchImpl(new URL(path, baseUrl), { signal: AbortSignal.timeout(5000) })
      .then((res) => res.body?.cancel?.())
      .catch(() => {});
  }, everyMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), everyMs };
}
