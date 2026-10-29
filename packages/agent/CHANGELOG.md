# Changelog

All notable changes to `pulseboard-agent` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/).

## 1.0.0 - 2026-10-29

First public release.

### Added

- `pulseboard(options)`: Express middleware that records status, duration and route pattern for every
  request and sends one aggregated report per window (request count, 2xx/4xx/5xx counts, p50/p95/p99,
  top 10 routes). Empty windows are sent too, so a report doubles as a heartbeat.
- `heartbeat(apiKey, endpoint)`: one empty report for cron jobs and serverless functions.
- Options `intervalSec` (alias `reportEverySec`), `serviceName` and `debug`, besides `apiKey`,
  `endpoint`, `enabled`, `logger`, `maxRoutes`, `maxSamples` and `handleSignals`.
- ESM and CommonJS builds with TypeScript definitions (`import` and `require` both work).
- The last window is flushed on `SIGTERM` and `beforeExit`.

### Behaviour

- Invalid options (for example a missing `apiKey`) throw a clear `TypeError` when the middleware is
  created. Once running, the agent never throws into your app.
- A failed send drops that window and logs one warning per outage, not one per window; it logs again
  when reports get through. There is no retry queue.
- Memory is bounded: at most 5000 latency samples and 50 distinct routes per window by default.
- Ids in a mounted router's path (`/users/42`, UUIDs, long hex or token-like segments) are masked as
  `:id`.

### Known limits

- When a route handler throws, Express leaves the router before the error handler answers, so that
  request is recorded under its route without the router's mount prefix.
- Requests that match no route (404s, static files) are all reported as `unmatched`.
