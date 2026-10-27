# pulseboard-agent

Push-first monitoring for Express apps. Instead of PulseBoard polling your app every minute, your
app sends **one small aggregated report per window** (default: every 60 s) describing the traffic
it actually served: request count, 4xx/5xx counts, latency percentiles and the busiest routes.

Because a report is sent **even when there was no traffic**, the report doubles as a heartbeat.
If reports stop, PulseBoard probes your app (optional `probeUrl`) and opens an incident when it is
really down.

- Zero runtime dependencies, ESM, Node.js ≥ 18 (uses the built-in `fetch`).
- Adds no awaited work to your requests: measuring is synchronous and O(1).
- Never throws into your app: a misconfiguration logs one warning and the middleware becomes a
  pass-through.
- Bounded memory, whatever the traffic.

## Install

```sh
npm install pulseboard-agent
```

## Usage

Create an **Agent** monitor in PulseBoard. The setup wizard shows your agent key **once**. Store it
as a secret (e.g. `PULSEBOARD_KEY`), never in your source code.

```js
import express from 'express';
import { pulseboard } from 'pulseboard-agent';

const app = express();
const agent = pulseboard({
  apiKey: process.env.PULSEBOARD_KEY,
  endpoint: 'https://your-pulseboard.example.com/api/v1',
});
app.use(agent); // register it before your routes

// …your routes…

app.listen(3000);
```

The returned middleware also has two methods:

| Method                       | What it does                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `agent.flush()`              | Sends the current window now. Resolves `true` on success, `false` otherwise; never rejects.       |
| `agent.stop({ flush=true })` | Stops the timer and the SIGTERM handler; by default sends the last window first. Use it in tests. |

## Configuration

| Option           | Default    | Notes                                                                                    |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `apiKey`         | (required) | The agent key from PulseBoard (`pbk_…`).                                                 |
| `endpoint`       | (required) | Your PulseBoard API base URL, ending in `/api/v1`.                                       |
| `reportEverySec` | `60`       | Window length in seconds, clamped to 30–300. Match the interval set on the monitor.      |
| `enabled`        | `true`     | `false` turns the agent into a silent pass-through (e.g. in local development or tests). |
| `logger`         | `console`  | Only `logger.warn` is used.                                                              |
| `maxRoutes`      | `50`       | Distinct routes tracked per window; further routes are counted under `other`.            |
| `maxSamples`     | `5000`     | Latency samples kept per window (reservoir sampling).                                    |
| `handleSignals`  | `true`     | Flush the last window on `SIGTERM`.                                                      |

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
  "uptimeSec": 86400
}
```

- `topRoutes` lists the 10 busiest routes of the window.
- Percentiles are nearest-rank over the sampled durations, in milliseconds. They are `null` in a
  window with no traffic.
- `hostname` is `os.hostname()`; `uptimeSec` is the process uptime.

## What is never sent

- **No URLs, ids or query strings.** Routes are reported as the Express route _pattern_
  (`req.baseUrl + req.route.path`, e.g. `/api/orders/:id`), never the concrete path
  (`/api/orders/8131?token=…`). Requests that matched no route (404s, static files) are reported
  as `unmatched`.
- No headers, cookies, bodies, IP addresses, user agents or user identifiers.
- No individual requests: only per-window counts and percentiles.

## Failure behaviour

- If PulseBoard can't be reached, or answers with a non-2xx status (e.g. `401` after the key was
  regenerated), the agent logs **one warning** and drops that window's data. The next window is
  sent normally. There is no retry queue, so memory stays bounded during long outages.
- Each report has a 5 s timeout.
- The report timer is `unref()`ed, so it never keeps your process alive.
- On `SIGTERM` the agent sends the current window once (2 s timeout). It never calls
  `process.exit()`: if your app has its own `SIGTERM` handler, that handler stays in charge. If
  not, the agent re-raises the signal after flushing, so Node's default termination still happens.

## License

MIT
