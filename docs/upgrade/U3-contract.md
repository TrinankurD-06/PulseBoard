# U3 contract: heartbeat monitors (push: zero requests to the customer)

Written at the start of the phase. Same ownership and coordination rules as U1/U2: backend owns
`packages/shared/**`, `apps/api/**`, `apps/worker/**`, `.env.example`, root `package.json`;
frontend owns `apps/client/**`; integration owns `docs/**`, validation and commits. Never block
waiting on the other track. Lesson from U2 (D75): wherever you touch Agenda or real jobs, add
at least one test against the real thing, not only a hand-built fake.

## Concept

A heartbeat monitor sends **no** requests. The customer's cron job / worker calls a secret
URL when it runs. If no ping arrives within `expectedEverySec + graceSec`, that's a failure.

## Data model

Monitor (`type: 'heartbeat'`):

| Field              | Type         | Notes                                                                                                          |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `expectedEverySec` | int          | ≥ mode minimum (10 DEMO_MODE / 30), ≤ 30 days                                                                  |
| `graceSec`         | int          | default 60, 0 – 86400                                                                                          |
| `heartbeatToken`   | string       | 32+ chars, `crypto.randomBytes(24).toString('base64url')`, **unique sparse index**                             |
| `lastPingAt`       | Date \| null |                                                                                                                |
| `lastStartAt`      | Date \| null | set by `/start`                                                                                                |
| `nextDueAt`        | Date \| null | `lastPingAt (or createdAt / resume time) + expectedEverySec + graceSec`; index `{ type, isPaused, nextDueAt }` |

- `url` becomes required **only for http** monitors; heartbeat monitors have none.
- `type` is immutable after creation (PATCH must not change it).
- Adaptive/budget/method/keyword/headers/cost fields don't apply to heartbeat monitors
  (not accepted by its schema; estimate = 0 requests).
- `CheckResult` gains `source`: `'http' | 'heartbeat' | 'agent' | 'probe' | 'external'`
  (missing = `'http'`). Run-check writes `'http'`.
- `MonitorUsage` gains `pings` (int, `$inc` per accepted ping): "requests received instead of
  sent", used by U5's Cost & Usage page.
- No migration needed for existing documents (missing fields = not heartbeat); indexes are
  created by `ensureCollections`. If you do need one, add `003-…` (idempotent).

## Incident thresholds per monitor type

`FAILURE_THRESHOLD` / `RECOVERY_THRESHOLD` become per type:
`http` and `agent` 3 / 2 (unchanged), `heartbeat` **1 / 1** (the grace period already
confirms; a daily job can't wait 3 days). `decideTransition`, `nextMonitorState` and
`TRANSITION_GUARDS` take the thresholds (a `thresholdsFor(type)` helper); existing http
behaviour and all existing state-machine tests stay identical.

## Shared incident engine

Move `createIncidentEngine` from `apps/worker/src/incidents/engine.js` to
`packages/shared/src/incident/engine.js` (export from `@pulseboard/shared/incident`); the
worker and the API both use it (the API's never-started Agenda instance can queue
`send-alert` jobs). It reads the monitor type to pick thresholds. Same atomic counting and
guarded transitions as today.

## Public ping endpoints (no login, token is the auth)

`GET|POST /api/v1/ping/:token`, `/api/v1/ping/:token/fail`, `/api/v1/ping/:token/start`

- Rate limit **per token**: 60 requests / minute → 429 (standard error shape).
- Unknown token → 404 `NOT_FOUND`. Paused monitor → 200 `{ "ok": true, "ignored": "paused" }`.
- `/ping/:token` (success): `lastPingAt = now`, `nextDueAt = now + expected + grace`, insert
  `CheckResult { ok: true, source: 'heartbeat', totalMs: <ms since lastStartAt if a /start
happened since the previous ping, else null> }`, feed the shared engine a success,
  `$inc MonitorUsage.pings`. Response `200 { "ok": true }`.
- `/ping/:token/fail`: same, but `ok: false`, `error` = `?message=` or JSON `{ message }`
  (≤ 500 chars) or `"Failure reported by the job"`; feeds a failure (opens an incident at once,
  threshold 1).
- `/ping/:token/start`: `lastStartAt = now`; no check result. `200 { "ok": true }`.
- Responses never reveal anything about the monitor beyond `ok`.

## Overdue detection (worker)

Agenda job `heartbeat-overdue` every 30 seconds:

- Find `{ type: 'heartbeat', isPaused: false, nextDueAt: { $lte: now } }`.
- For each, **atomically advance** `nextDueAt += expectedEverySec` with a conditional update on
  the old `nextDueAt` (only one worker processes a missed period), then insert
  `CheckResult { ok: false, source: 'heartbeat', error: 'No ping received within <expected> + <grace> grace' }`
  and feed a failure to the shared engine. **One failure per missed period**, so uptime % =
  share of expected periods that had a ping.
- A ping after an incident resolves it via the normal recovery rule (threshold 1 → first ping).

## API changes

- `POST /workspaces/:wid/monitors` accepts `{ type: 'heartbeat', name, expectedEverySec, graceSec }`
  (validated by a heartbeat schema chosen by `type`; default type `http` keeps today's
  behaviour). The response includes `heartbeatToken` (members/owners; masked `••••••` for
  viewers, like headers).
- `POST /workspaces/:wid/monitors/:mid/heartbeat-token` (member): new token, old one stops
  working immediately → `{ data: monitor }`.
- Pause/resume work for heartbeat (resume sets `nextDueAt = now + expected + grace`,
  status `pending`). "Test now" on a heartbeat → `400 { code: 'NOT_SUPPORTED' }`.
- The scheduler and the boot reconcile only create `run-check` jobs for **http** monitors
  (`scheduleMonitor` is a no-op for others; reconcile removes stray jobs for non-http).
- Live payload whitelist + change-stream `$match` include `lastPingAt` and `nextDueAt`.
- Usage endpoint for heartbeat monitors: `requests: 0`, `estimatedMonthly: 0`, plus
  `pings` (this month).
- Alerts/notices for heartbeat monitors have no URL: message says
  "No ping from <name> since <time>" / "<name> is sending pings again".

## Backend tests

Thresholds per type (http unchanged, heartbeat 1/1); ping endpoints (success, fail with
message, start → duration on next ping, unknown token 404, paused ignored, per-token rate
limit 429, no auth needed); overdue detection: exactly one failure per missed period even
with two concurrent detector runs, opens an incident, next ping resolves it; RBAC: viewer
can't regenerate the token and sees it masked; regenerated token invalidates the old one;
scheduler/reconcile skip heartbeat monitors; heartbeat check results feed uptime/daily
rollups and the public status page; "Test now" → 400.

## Frontend work

1. **New monitor: choose a type** at the top: "Website / API (we check it)" (existing form)
   vs "Heartbeat (your job pings us)". Agent shows as "coming soon" (U4).
2. **Heartbeat form** (create + edit): name, "Expect a ping every" (presets 1m, 5m, 15m, 1h,
   6h, 1d, 1w, respecting `/meta` `minIntervalSec`), "Grace period" (presets 0, 1m, 5m, 15m,
   1h). Shows "0 requests/month to your servers".
3. **Heartbeat detail page** (instead of the http-specific parts):
   - Ping URL `${window.location.origin}/api/v1/ping/<token>` with copy button, and tabs of
     copy-paste snippets: curl, cron line (`*/5 * * * * your-job.sh && curl -fsS <url>`),
     Node `fetch`, and how to use `/start` (duration) and `/fail` (explicit failure).
     Viewers see the token masked and no snippets.
   - "Regenerate token" (members/owners, confirm dialog, warns that the old URL stops working).
   - "Last ping X ago", "Next ping expected by <time>" (from `nextDueAt`), live via the
     existing socket cache patch (`lastPingAt`, `nextDueAt` are in `check:result`).
   - **Ping history chart**: last ~60 results from `/checks?limit=60` as a timeline (green =
     ping, red = missed/failed; text labels/tooltips; table view like other charts), plus run
     duration when present.
   - Keep uptime tiles, 90-day bars, incidents. Hide Test now, response-time/timing charts,
     method/keyword config, cost/budget.
4. **Dashboard card** for heartbeat: "Last ping" instead of "Response", interval shows
   "every 1h · heartbeat".
5. Client tests for any pure helpers (snippet builders, label formatting). Lint, tests, build.
