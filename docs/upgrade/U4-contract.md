# U4 contract: `pulseboard-agent` + probe-on-silence (push-first)

Written at the start of the phase. Ownership for U4:

| Owner            | Paths                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| backend          | `packages/shared/**`, `apps/api/**`, `apps/worker/**`, `.env.example`, root `package.json` (except adding the workspace, already covered by `packages/*`) |
| frontend (+ SDK) | `apps/client/**` **and** `packages/agent/**` (the customer-facing npm package)                                                                            |
| core             | `docs/**`, validation, commits                                                                                                                            |

Coordination as before: never block on the other track; tell it only about changes that affect
the other side; report deviations. Lesson from
U2 (D75): anything touching Agenda/real jobs gets at least one test against the real thing.

## 1. The npm package `packages/agent` (name `pulseboard-agent`, ESM, zero runtime deps, Node ≥ 18)

```js
import { pulseboard } from 'pulseboard-agent';
const agent = pulseboard({ apiKey: process.env.PULSEBOARD_KEY, endpoint: 'https://…/api/v1' });
app.use(agent); // Express middleware; agent.flush(), agent.stop() also available
```

Options: `apiKey` (required), `endpoint` (required, base URL ending in `/api/v1`),
`reportEverySec` (default 60, clamped 30–300), `enabled` (default true), `logger`
(default `console`, only `.warn` used), `maxRoutes` (default 50), `maxSamples` (default 5000).

Per request (on `res` `finish`/`close`): status code, duration via `process.hrtime.bigint()`,
route **pattern** = `req.baseUrl + req.route.path` when Express matched a route, else
`'unmatched'`. Never the full URL, ids or query strings (no PII).

Aggregation per window, bounded memory: counters, 4xx/5xx, durations kept in a reservoir of at
most `maxSamples` (reservoir sampling), per-route counters limited to `maxRoutes` keys (extra
routes counted under `'other'`). Percentiles: nearest-rank on the sorted samples.

Every `reportEverySec` (timer `unref()`ed) POST `${endpoint}/agent/report` with
`Authorization: Bearer <apiKey>`, JSON body:

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

- **Sends a report even with zero traffic** (`requests: 0`, percentiles `null`): it doubles as
  a heartbeat, so silence means the app is down.
- Non-blocking: recording is O(1) and never awaits; never throws into the host app.
- Unreachable PulseBoard / non-2xx → one `logger.warn`, that window's data is **dropped**; the
  next window is sent normally (no retry queue, bounded memory). 5 s request timeout.
- `SIGTERM`: flush the current window once (best effort, short timeout), never call
  `process.exit` (the host decides). Remove the listener on `stop()`.
- `README.md`: install, configuration, exactly what data is sent and what is not.
- Own Vitest tests: aggregation, percentiles, route patterns (no ids/query), zero-traffic
  report, failure handling (endpoint down → warn, no throw, next window ok), bounded memory,
  `stop()`, middleware adds no awaited latency.
- Add `packages/agent` to the root Vitest runs (`npm test` runs every workspace already).

## 2. Server side (backend)

Monitor (`type: 'agent'`):

| Field                   | Notes                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentKeyHash`          | SHA-256 hex of the key; unique sparse index. The key `pbk_<32 base64url>` is returned **once** (create / regenerate response field `agentKey`), never stored readable |
| `agentKeyPrefix`        | first 8 chars (e.g. `pbk_Ab3d`) for display                                                                                                                           |
| `reportEverySec`        | 30–300, default 60                                                                                                                                                    |
| `errorRateThreshold`    | percent, default 5 (0–100)                                                                                                                                            |
| `p95ThresholdMs`        | optional                                                                                                                                                              |
| `probeUrl`              | optional, SSRF-validated like monitor URLs                                                                                                                            |
| `externalCheckEverySec` | optional (off by default; UI suggests 900–1800), 300–86400                                                                                                            |
| `lastReportAt`          | Date                                                                                                                                                                  |
| `silenceState`          | `'reporting' \| 'probing' \| 'silent'`                                                                                                                                |
| `silentNoticeAt`        | once-per-silence marker for the "agent silent, endpoint reachable" notice                                                                                             |

- New status **`degraded`** (enum + constants): "agent silent but endpoint reachable". Public
  status pages show it as operational (`overallStatus` ignores it like up). Not an incident.
- `AgentReport` time-series collection (`timeField: windowEnd`, meta `{monitorId, workspaceId}`,
  7-day TTL) storing the report fields.
- `POST /api/v1/agent/report`: Bearer agent key (hash lookup), 401 on missing/bad key,
  Zod-validated body (400), rate limit per key 30/min (429), body limit as global.
  Evaluation (pure, shared, unit-tested `evaluateAgentReport(report, monitor)`):
  `requests > 0` and error rate `errors5xx / requests > errorRateThreshold %` → failure
  ("Error rate 8.2 % above 5 %"); `p95ThresholdMs` set and `p95Ms > threshold` → failure;
  otherwise success (zero traffic = alive = success). Write `CheckResult { source: 'agent',
ok, totalMs: p50Ms }`, feed the shared engine (agent thresholds 3/2), update `lastReportAt`,
  set `silenceState: 'reporting'`, and if the monitor was `degraded` set it back to `up`.
  `$inc MonitorUsage.reports`. Response `202 { "ok": true }`.
- **Silence job** `agent-silence` every 30 s: agent monitors, not paused,
  `silenceState: 'reporting'` and `lastReportAt` (or `createdAt`) older than
  `2 × reportEverySec` → conditional update to `'probing'` (one worker wins), then:
  - with `probeUrl`: up to 3 HEAD probes with the existing runner, 10 s apart; each stored as
    `CheckResult { source: 'probe' }`, counted with `recordUsage`, and fed to the engine. All 3
    fail → the engine opens the incident (3 failures). Any probe succeeds → stop probing, status
    `degraded` (unless down), send the `agent_silent` notice once (`silentNoticeAt`).
  - without `probeUrl`: feed one failure ("No report for 130 s") per detector cycle while
    silent, so the incident opens after 3 cycles.
  - then `silenceState: 'silent'`. While silent and degraded, repeat the probe sequence every
    5 minutes. A report resets everything (see above); the engine resolves the incident after 2
    good reports.
- **External check** (`externalCheckEverySec`, requires `probeUrl`): a repeating `run-check`
  job for agent monitors (reconcile/scheduler include agent monitors that have it); the handler
  runs the check against `probeUrl`, stores `source: 'external'`, counts usage, and on failure
  starts the same 3-probe confirmation (success is recorded but not fed to the engine).
- `estimateMonthlyRequests(agent)` = external checks per 30 days (0 if off);
  `estimateRequestsSaved(monitor)` = 43,200 (1-minute polling) − estimate, floored at 0, for
  all types (http: 43,200 − its estimate).
- API: create `{ type: 'agent', name, reportEverySec?, errorRateThreshold?, p95ThresholdMs?,
probeUrl?, externalCheckEverySec? }` → response includes `agentKey` once;
  `POST /monitors/:mid/agent-key` (member) → new key once, old key 401 immediately;
  `GET /monitors/:mid/agent-metrics?from&to` (viewer, default last 1 h, ≤ 24 h) →
  `{ points: [{ t, requests, errors5xx, errors4xx, errorRate, p50Ms, p95Ms, p99Ms }],
topRoutes: [{ route, requests, errors5xx, p95Ms }], lastReport: { hostname, agentVersion,
uptimeSec, windowEnd } }` (downsample to ≤ 500 points); usage endpoint adds `reports`,
  `requestsSaved`. "Test now" on agent → checks `probeUrl` if set, else 400 `NOT_SUPPORTED`.
  Live payload + stream `$match` add `lastReportAt`, `silenceState`.
- Notice kind `agent_silent` ("<name>: agent stopped reporting, but <probeUrl host> still
  answers").
- Tests: evaluation (unit); report auth (no key / bad key 401, regenerated key invalidates
  old), validation 400, rate limit 429, threshold breach x3 → incident, 2 good reports resolve;
  silence → probes (local test server down) → incident; silence → probe OK → degraded + one
  notice; no probeUrl → failures per cycle → incident; external check failure → confirmation;
  RBAC (viewer can't regenerate key, can read metrics); real-Agenda test for the silence job.

## 3. Frontend (client)

- Type chooser: enable "Agent (your app reports to us)".
- **Setup wizard**: (1) name + report interval + thresholds + optional probe URL / external
  check (suggest 900–1800 s), (2) after create: `npm install pulseboard-agent`, code snippet with
  the endpoint (`${window.location.origin}/api/v1`) and the key shown **once** (copy button,
  "I've saved my key" to continue, warning it won't be shown again), (3) "Waiting for the first
  report…" turning into "Connected" live (via `lastReportAt` in `check:result`).
- **Agent detail page**: last report ago, hostname/version, state (reporting / probing /
  silent / degraded banner); live charts (ChartCard + table view) from `agent-metrics`: request
  rate, error rate (with threshold line), p50/p95/p99; top routes table; "≈ 42,000
  requests/month saved vs 1-minute polling" stat from usage; regenerate key (shows the new key
  once); keep uptime tiles, 90-day bars, incidents.
- Dashboard card: "Last report", `agent` label; degraded status styling (amber + "Degraded"
  text) in status styles, badges and the public status page label map (degraded → shown as
  Operational publicly).
