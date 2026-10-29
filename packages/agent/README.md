# pulseboard-agent

Push-first monitoring for Express apps. Instead of PulseBoard polling your app every minute, your
app sends **one small aggregated report per window** (default: every 60 s) describing the traffic
it actually served: request count, 4xx/5xx counts, latency percentiles and the busiest routes.

Because a report is sent **even when there was no traffic**, the report doubles as a heartbeat.
If reports stop, PulseBoard probes your app (optional `probeUrl`) and opens an incident when it is
really down.

- Zero runtime dependencies, Node.js ≥ 18 (uses the built-in `fetch`).
- ESM and CommonJS, with TypeScript definitions.
- Adds no awaited work to your requests: measuring is synchronous and O(1).
- Bounded memory, whatever the traffic.
- Never throws into your app once it is running.

## Install

```sh
npm install pulseboard-agent
```

## Quick start (Express)

Create an **Agent** monitor in PulseBoard. The setup wizard shows your agent key **once**. Store it
as a secret (for example `PULSEBOARD_KEY`), never in your source code.

```js
import express from 'express';
import { pulseboard } from 'pulseboard-agent';

const app = express();

app.use(
  pulseboard({
    apiKey: process.env.PULSEBOARD_KEY,
    endpoint: 'https://your-pulseboard.example.com/api/v1',
  }),
); // register it before your routes

app.get('/api/orders/:id', (req, res) => res.json({ ok: true }));

app.listen(3000);
```

CommonJS works the same way:

```js
const { pulseboard } = require('pulseboard-agent');
```

The middleware has two extra methods:

| Method                       | What it does                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `agent.flush()`              | Sends the current window now. Resolves `true` on success, `false` otherwise; never rejects.        |
| `agent.stop({ flush=true })` | Stops the timer and the process handlers; by default sends the last window first. Use it in tests. |

## Options

| Option           | Default    | Notes                                                                                                        |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `apiKey`         | (required) | The agent key from PulseBoard (`pbk_…`). A missing or empty key throws at start-up.                          |
| `endpoint`       | (required) | Your PulseBoard API base URL, ending in `/api/v1`. Must be a valid `http(s)` URL.                            |
| `intervalSec`    | `60`       | Window length in seconds, clamped to 30–300. Match the interval set on the monitor.                          |
| `reportEverySec` |            | Alias of `intervalSec`.                                                                                      |
| `serviceName`    |            | A label for this service (up to 100 characters), sent with every report.                                     |
| `debug`          | `false`    | Logs one line per report to `logger.info`.                                                                   |
| `enabled`        | `true`     | `false` turns the agent into a silent pass-through (local development, tests). Nothing is validated or sent. |
| `logger`         | `console`  | Only `logger.warn` (and `logger.info` with `debug`) is used.                                                 |
| `maxRoutes`      | `50`       | Distinct routes tracked per window; further routes are counted under `other`.                                |
| `maxSamples`     | `5000`     | Latency samples kept per window (reservoir sampling).                                                        |
| `handleSignals`  | `true`     | Flush the last window on `SIGTERM` and `beforeExit`.                                                         |

Invalid options throw a `TypeError` with a clear message when `pulseboard()` is called, so a missing
key shows up at boot rather than in production. If the key comes from an environment variable that
isn't set, the error says so.

## What is sent

Every window, one `POST <endpoint>/agent/report` with `Authorization: Bearer <apiKey>` and this
JSON body:

```json
{
  "windowStart": "2026-10-27T03:00:00.000Z",
  "windowEnd": "2026-10-27T03:01:00.000Z",
  "requests": 1234,
  "errors5xx": 3,
  "errors4xx": 17,
  "p50Ms": 12.4,
  "p95Ms": 88.1,
  "p99Ms": 240.3,
  "topRoutes": [{ "route": "/api/orders/:id", "requests": 410, "errors5xx": 1, "p95Ms": 95.2 }],
  "agentVersion": "1.0.0",
  "hostname": "web-1",
  "uptimeSec": 86400,
  "serviceName": "checkout-api"
}
```

- `topRoutes` lists the 10 busiest routes of the window.
- Percentiles are nearest-rank over the sampled durations, in milliseconds. They are `null` in a
  window with no traffic.
- `hostname` is `os.hostname()`; `uptimeSec` is the process uptime. `serviceName` is present only if
  you set it.

## Heartbeat for cron jobs and serverless functions

A script that runs for a few seconds can't use the middleware. Call `heartbeat()` once per run
instead: it sends one empty report, and PulseBoard treats a missing heartbeat like a silent agent.

```js
import { heartbeat } from 'pulseboard-agent';

await runNightlyBackup();
const ok = await heartbeat(
  process.env.PULSEBOARD_KEY,
  'https://your-pulseboard.example.com/api/v1',
);
```

`heartbeat(apiKey, endpoint, { serviceName, timeoutMs })` resolves `true` when PulseBoard accepted the
report and `false` otherwise. It never rejects and never retries. It throws only for a missing or
malformed `apiKey` or `endpoint`. Await it before the function returns: serverless runtimes may
freeze the process as soon as the handler finishes.

An Agent monitor expects a report at least every 300 s (its longest interval), so `heartbeat()` fits
functions and jobs that run that often, or a long-lived worker that calls it on a timer. For a job
that runs less often (hourly, nightly), use a PulseBoard **Heartbeat** monitor and its ping URL
instead: the gaps between runs would otherwise look like silence.

## Privacy: what is never sent

- **No URLs, ids or query strings.** Routes are reported as the Express route _pattern_
  (`req.baseUrl + req.route.path`, for example `/api/orders/:id`), never the concrete path
  (`/api/orders/8131?token=…`). Requests that matched no route (404s, static files) are reported
  as `unmatched`. Ids in a mounted router's path (numbers, UUIDs, long hex or token-like segments)
  are masked as `:id`.
- No headers, cookies, bodies, IP addresses, user agents or user identifiers.
- No individual requests: only per-window counts and percentiles.

The only identifying data are the `hostname` of the machine and the optional `serviceName`.

## Failure behaviour

- If PulseBoard can't be reached, or answers with a non-2xx status (for example `401` after the key
  was regenerated), the agent drops that window's data and logs **one warning per outage**. The next
  window is sent normally and a line is logged when reports get through again. There is no retry
  queue, so memory stays bounded during long outages.
- Each report has a 5 s timeout and runs in the background, never inside a request.
- The report timer is `unref()`ed, so it never keeps your process alive.
- On `SIGTERM` and `beforeExit` the agent sends the current window once (2 s timeout). It never
  calls `process.exit()`: if your app has its own `SIGTERM` handler, that handler stays in charge. If
  not, the agent re-raises the signal after flushing, so Node's default termination still happens.

## Troubleshooting

| Symptom                                             | Likely cause and fix                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TypeError: [pulseboard-agent] apiKey is required`  | The key is missing. If you use `process.env.PULSEBOARD_KEY`, make sure the variable is set in this environment.                                        |
| `endpoint is required` / `not a valid URL`          | Pass the full API base URL, for example `https://your-pulseboard.example.com/api/v1`.                                                                  |
| Warning `PulseBoard answered HTTP 401`              | The key was regenerated or revoked. Use the new key and restart the app.                                                                               |
| Warning `PulseBoard answered HTTP 400`              | The agent and server disagree on the report format. Update `pulseboard-agent`.                                                                         |
| Warning `could not reach PulseBoard`                | Network, DNS or firewall: the app must be able to make outbound HTTPS requests to your PulseBoard host. Check the `endpoint`.                          |
| The monitor stays on "Waiting for the first report" | The agent registers on start but reports after one full interval. Wait one window, or call `await agent.flush()` once. Set `debug: true` to see sends. |
| Everything shows under route `unmatched`            | Register `pulseboard()` **before** your routes, and use `app.get(...)` style routes. Static files and 404s are always `unmatched`.                     |
| Routes lose their mount prefix on errors            | Known limit: when a handler throws, Express leaves the router before the error handler answers, so that request is recorded without the prefix.        |
| Reports stop in serverless                          | The platform freezes the process between invocations. Use `await heartbeat(...)` inside the function instead of the middleware.                        |
| Nothing is sent in development                      | You set `enabled: false`, or the process exited before the first window. Use `agent.flush()` or `heartbeat()` for short scripts.                       |

## TypeScript

Type definitions ship with the package (`PulseboardOptions`, `PulseboardMiddleware`,
`HeartbeatOptions`, `PulseboardReport`). They don't require `@types/express`.

## License

MIT
