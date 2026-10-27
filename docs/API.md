# API reference

Base URL: `/api/v1` (in development the Vite dev server proxies it to `http://localhost:4000`;
in production Vercel rewrites it to the Render API).

## Conventions

**Authentication.** Send the access token in a header:
`Authorization: Bearer <accessToken>`. Access tokens last 15 minutes. The refresh token is an
httpOnly cookie (`pb_refresh`, path `/api/v1/auth`) that the browser sends automatically to
`/auth/refresh` and `/auth/logout`.

**Responses.**

```jsonc
// single resource
{ "data": { ... } }
// list
{ "data": [ ... ], "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
// error (every error, every endpoint)
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [ { "path": "url", "message": "Enter a full URL" } ] } }
```

**Pagination.** List endpoints accept `?page=1&limit=20` (`limit` max 100).

**Error codes.**

| HTTP | `code`                                                         | When                                                   |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`                                             | Body/query failed Zod validation (`details` per field) |
| 400  | `BAD_REQUEST`, `UNSAFE_TARGET`                                 | Malformed JSON; URL points to a private address (SSRF) |
| 401  | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN` | Missing/expired token; wrong login; bad refresh        |
| 403  | `FORBIDDEN`                                                    | Member of the workspace, but role too low              |
| 404  | `NOT_FOUND`                                                    | Missing resource, or not a member of the workspace     |
| 400  | `NOT_SUPPORTED`                                                | Action doesn't apply to this monitor type              |
| 409  | `CONFLICT`, `LAST_OWNER`                                       | Duplicate (email, slug, member); last owner protection |
| 409  | `BUDGET_EXCEEDED`                                              | Resume of a monitor paused by its budget, still over   |
| 413  | `PAYLOAD_TOO_LARGE`                                            | Body over 100 kB                                       |
| 429  | `RATE_LIMITED`                                                 | Rate limit hit (see below)                             |
| 502  | `ALERT_DELIVERY_FAILED`                                        | Test alert couldn't be delivered                       |
| 500  | `INTERNAL`                                                     | Unexpected error (details are logged, not returned)    |

OAuth sign-in failures (`OAUTH_NOT_CONFIGURED`, `OAUTH_DENIED`, `OAUTH_STATE_INVALID`,
`OAUTH_EMAIL_UNVERIFIED`, `OAUTH_PROVIDER_ERROR`) are not JSON responses: they arrive as
`?status=error&code=…` on the redirect to the client (see
[Sign in with Google / GitHub](#sign-in-with-google--github)).

**Roles.** `viewer` (read) < `member` (+ monitors, alert channels, status pages) < `owner`
(+ members, workspace settings). The minimum role is listed for each workspace endpoint.

**Rate limits.** login/register: 20 per 15 min per IP · OAuth start/callback: 40 per 15 min
per IP · refresh: 60 per 15 min per IP ·
"Test now": 5 per min per user · test alert: 5 per min per user · public status: 120 per min per IP
· heartbeat pings: 60 per min per token · agent reports: 30 per min per key.

---

## Health

### `GET /health` (API, no prefix)

```json
{
  "status": "ok",
  "mongo": "connected",
  "changeStreams": { "monitors": "live", "incidents": "live" },
  "uptimeSec": 3605
}
```

`status` is `degraded` (still 200) if a change stream isn't live; 503 if MongoDB is down.

### `GET /health` (worker, port 4002)

```json
{ "status": "ok", "mongo": "connected", "agenda": "running", "overdueJobs": 0 }
```

### `GET /meta`

Public runtime settings used by the client.

```json
{ "data": { "demoMode": true, "minIntervalSec": 10, "maxIntervalSec": 86400 } }
```

---

## Auth

### `POST /auth/register`

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "password123" }
```

`201`. Creates the user, a personal workspace (owner) and a session. Sets the `pb_refresh` cookie.

```json
{
  "data": {
    "user": {
      "id": "66f…",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "createdAt": "…",
      "updatedAt": "…"
    },
    "accessToken": "eyJhbGciOi…"
  }
}
```

Errors: `400` validation (password 8–72 chars), `409` email taken, `429`.

### `POST /auth/login`

```json
{ "email": "ada@example.com", "password": "password123" }
```

`200`, same response shape as register. Wrong password, unknown email, and an account that
signed up with Google/GitHub and has no password all return `401 INVALID_CREDENTIALS`.

### `POST /auth/refresh`

No body; uses the cookie. Rotates the refresh token (new cookie) and returns a new access token.

```json
{ "data": { "accessToken": "eyJhbGciOi…" } }
```

Reusing an already-rotated token returns `401 INVALID_REFRESH_TOKEN` and revokes every
session from that login.

### `POST /auth/logout`

`204`. Revokes the session and clears the cookie.

### `GET /auth/me` (auth)

```json
{
  "data": {
    "user": {
      "id": "66f…",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "providers": ["google"],
      "hasPassword": true
    },
    "workspaces": [
      {
        "id": "66f…",
        "name": "Ada's workspace",
        "slug": "ada-s-workspace-3f9a1c",
        "ownerId": "66f…",
        "role": "owner"
      }
    ]
  }
}
```

`providers` lists the linked sign-in providers by name only; `hasPassword` is `false` for
accounts created with Google/GitHub. Provider account ids and the password hash are never
returned.

### Sign in with Google / GitHub

Authorization code flow with PKCE (S256) and `state`. A provider is enabled only when both its
`*_CLIENT_ID` and `*_CLIENT_SECRET` are set. `start` and `callback` are **browser
navigations**, not fetch calls: they always answer `302`.

#### `GET /auth/oauth/providers`

The enabled providers, in this order. Empty when none is configured (the client hides the
buttons).

```json
{
  "data": [
    { "id": "google", "name": "Google" },
    { "id": "github", "name": "GitHub" }
  ]
}
```

#### `GET /auth/oauth/:provider/start?next=/app/...`

`302` to the provider's consent page. Sets `pb_oauth` (httpOnly, SameSite=Lax, path
`/api/v1/auth/oauth`, 10 minutes, HMAC-signed) holding the state, the PKCE verifier and
`next`. `next` must be a relative path starting with a single `/`; anything else (`//host`,
`/host`, `https:`, control characters, over 512 chars) becomes `/app`.

The provider is sent back to `${APP_URL}/api/v1/auth/oauth/:provider/callback` (`APP_URL`
defaults to `DASHBOARD_URL`): the client origin, which proxies `/api` to the API.

#### `GET /auth/oauth/:provider/callback`

Called by the provider. Verifies `state` against the cookie (constant time), exchanges the code
with the verifier, reads the profile, then picks the user:

1. this provider account is already linked → that user;
2. else the provider says the email is **verified** and a user has that email → link to them;
3. else create a user (name from the profile, no password) with a personal workspace, as
   registration does.

It then sets the `pb_refresh` cookie exactly as login does, clears `pb_oauth`, and redirects:

| Result  | Redirect                                                                    |
| ------- | --------------------------------------------------------------------------- |
| Success | `${APP_URL}/auth/callback?status=ok&next=<sanitised next>`                  |
| Failure | `${APP_URL}/auth/callback?status=error&code=<code>` (no session is created) |

The client then calls `POST /auth/refresh` to get an access token. No token is ever put in a
URL.

| `code`                   | When                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `OAUTH_NOT_CONFIGURED`   | Unknown provider, or its credentials aren't set                        |
| `OAUTH_DENIED`           | The user pressed "Cancel" at the provider (`error=access_denied`)      |
| `OAUTH_STATE_INVALID`    | Missing, expired, forged or mismatched state (or another provider's)   |
| `OAUTH_EMAIL_UNVERIFIED` | The provider has no verified (GitHub: primary verified) email for them |
| `OAUTH_PROVIDER_ERROR`   | Token exchange or profile request failed (network, non-2xx, bad body)  |
| `RATE_LIMITED`           | Too many sign-in attempts from this IP                                 |
| `INTERNAL`               | Unexpected server error (logged)                                       |

---

## Workspaces

### `GET /workspaces` (auth)

Paginated list of the caller's workspaces, each with the caller's `role`.

### `POST /workspaces` (auth)

```json
{ "name": "Acme Inc." }
```

`201` `{ "data": { "id": "…", "name": "Acme Inc.", "slug": "acme-inc-1b2c3d", "role": "owner", … } }`

### `GET /workspaces/:wid` (viewer)

`{ "data": { "id": "…", "name": "Acme Inc.", "slug": "…", "ownerId": "…", "role": "member" } }`

### `PATCH /workspaces/:wid` (owner)

`{ "name": "Acme Corporation" }` → `200` updated workspace.

### `DELETE /workspaces/:wid` (owner)

`204`. Cancels all check jobs, then deletes monitors, check history, rollups, incidents,
alert channels, status pages, memberships and the workspace.

## Members

### `GET /workspaces/:wid/members` (viewer)

```json
{ "data": [{ "userId": "…", "name": "Ada Lovelace", "email": "ada@example.com", "role": "owner", "joinedAt": "…" }], "pagination": { … } }
```

### `POST /workspaces/:wid/members` (owner)

```json
{ "email": "grace@example.com", "role": "member" }
```

`201` member. The user must already have an account (`404` otherwise); `409` if already a member.

### `PATCH /workspaces/:wid/members/:uid` (owner)

`{ "role": "viewer" }` → `200` member. `409 LAST_OWNER` if it would leave no owner.

### `DELETE /workspaces/:wid/members/:uid` (owner)

`204`. `409 LAST_OWNER` when removing the only owner.

---

## Monitors

Monitor object (as returned to members/owners; for viewers, header **values** are masked):

```json
{
  "id": "66f…",
  "workspaceId": "66f…",
  "name": "Checkout API",
  "url": "https://api.example.com/health",
  "method": "GET",
  "intervalSec": 30,
  "timeoutMs": 10000,
  "expectedStatus": { "min": 200, "max": 399 },
  "keyword": "ok",
  "headers": { "X-Api-Key": "secret" },
  "isPaused": false,
  "status": "up",
  "consecutiveFailures": 0,
  "consecutiveSuccesses": 41,
  "lastCheckedAt": "2026-10-27T09:12:31.004Z",
  "lastResponseMs": 87.4,
  "lastOk": true,
  "lastStatusCode": 200,
  "lastError": null,
  "lastTimings": { "dnsMs": 3.1, "tcpMs": 11.2, "tlsMs": 24.9, "ttfbMs": 46.0, "downloadMs": 2.2 },
  "sslExpiresAt": "2027-01-15T23:59:59.000Z",
  "type": "http",
  "headUnsupported": false,
  "costPer1kRequests": 0.5,
  "currency": "INR",
  "adaptive": true,
  "minIntervalSec": 30,
  "maxIntervalSec": 600,
  "currentIntervalSec": 120,
  "monthlyRequestBudget": 20000,
  "budgetAction": "slow",
  "budgetExceededMonth": null,
  "pausedReason": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

There are three monitor **types**, fixed at creation (`PATCH` can't change `type`):

| `type`      | Who sends traffic                                    | Type-specific fields                                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `http`      | PulseBoard checks the URL (pull)                     | `url`, `method`, `intervalSec`, `timeoutMs`, `expectedStatus`, `keyword`, `headers`, cost, adaptive and budget fields above                                                                                                                                        |
| `heartbeat` | Your job pings PulseBoard (push)                     | `expectedEverySec`, `graceSec`, `heartbeatToken` (masked `••••••` for viewers), `lastPingAt`, `lastStartAt`, `nextDueAt`                                                                                                                                           |
| `agent`     | `pulseboard-agent` in your app reports to PulseBoard | `reportEverySec`, `errorRateThreshold` (%), `p95ThresholdMs`, `probeUrl`, `externalCheckEverySec`, `agentKeyPrefix`, `lastReportAt`, `silenceState` (`reporting`, `probing`, `silent`). The key itself is never stored readable (`agentKeyHash` is never returned) |

`status`: `pending` | `up` | `down` | `paused` | `degraded`. `degraded` only happens for agent
monitors: the agent stopped reporting but the probe URL still answers. It is not an incident, and
public status pages show it as operational.

Adaptive interval (http): `intervalSec` is the **base** interval and `currentIntervalSec` is what
the scheduler uses right now. After 10 successful checks in a row the interval doubles (up to
`maxIntervalSec`). A failure, a `down` status or a response slower than twice the 24 h average
brings it back down. When a monthly budget is reached, `budgetAction` decides: `slow` (check
every 15 min until the next month) or `pause` (`pausedReason: "budget_exceeded"`).

### `GET /workspaces/:wid/monitors` (viewer)

Paginated, newest first. Optional `?status=up|down|pending|paused|degraded`.

### `POST /workspaces/:wid/monitors` (member)

```json
{
  "name": "Checkout API",
  "url": "https://api.example.com/health",
  "method": "GET",
  "intervalSec": 30,
  "timeoutMs": 10000,
  "expectedStatus": { "min": 200, "max": 299 },
  "keyword": "ok",
  "headers": { "X-Api-Key": "secret" }
}
```

Only `name`, `url` and `intervalSec` are required (`type` defaults to `http`). Rules: `intervalSec`
≥ 30 (≥ 10 in DEMO_MODE), ≤ 86400; `timeoutMs` 1000–30000 and ≤ interval; `method` GET/HEAD/POST;
`Host`, `Content-Length` and similar headers can't be set. `201` monitor (status `pending`); its
check job is scheduled and runs right away. `400 UNSAFE_TARGET` for private/loopback/metadata
addresses (unless `ALLOW_PRIVATE_TARGETS=true`).

Cost-related fields (all optional) and their defaults for new monitors:

- `method` defaults to `HEAD`, or `GET` when a `keyword` is set. `HEAD` with a keyword is rejected
  (`method`: "HEAD responses have no body"). If a server answers `HEAD` with 405/501, the checker
  retries with `GET` and remembers it (`headUnsupported: true`).
- `costPer1kRequests` (≥ 0 or `null`) and `currency` (`INR` default, `USD`, `EUR`, `GBP`).
- `adaptive` defaults to `true`, with `minIntervalSec` (≥ mode minimum, ≤ `intervalSec`) and
  `maxIntervalSec` (≥ `intervalSec`, default 600). When adaptive, `timeoutMs` must fit in
  `minIntervalSec`.
- `monthlyRequestBudget` (integer ≥ 1 or `null`) and `budgetAction` (`slow` default, or `pause`).

**Heartbeat** monitor:

```json
{ "type": "heartbeat", "name": "Nightly backup", "expectedEverySec": 86400, "graceSec": 900 }
```

`expectedEverySec` ≥ mode minimum and ≤ 30 days; `graceSec` 0–86400 (default 60). The response
includes `heartbeatToken`; the ping URL is `/api/v1/ping/<heartbeatToken>`. No `url`, no check job.

**Agent** monitor:

```json
{
  "type": "agent",
  "name": "Checkout API",
  "reportEverySec": 60,
  "errorRateThreshold": 5,
  "p95ThresholdMs": 800,
  "probeUrl": "https://api.example.com/health",
  "externalCheckEverySec": 1800
}
```

All but `name` are optional: `reportEverySec` 30–300 (default 60), `errorRateThreshold` 0–100
(default 5), `probeUrl` (SSRF-checked like `url`), `externalCheckEverySec` 300–86400 (needs
`probeUrl`; off by default). The `201` response contains **`agentKey` once** (`pbk_…`). Only its
SHA-256 hash is stored, so it can't be shown again.

### `GET /workspaces/:wid/monitors/:mid` (viewer)

`200` monitor.

### `PATCH /workspaces/:wid/monitors/:mid` (member)

Any subset of the create fields, e.g. `{ "intervalSec": 60 }`. Merged with the stored monitor
and re-validated as a whole; the job is rescheduled with the new interval. Changing `intervalSec`
or `adaptive` resets `currentIntervalSec` to the base interval. Raising `monthlyRequestBudget`
above this month's usage lifts a budget pause or slowdown immediately.

### `POST /workspaces/:wid/monitors/:mid/heartbeat-token` (member)

Heartbeat monitors only (`400 NOT_SUPPORTED` otherwise). `200` monitor with a new
`heartbeatToken`; the old ping URL returns `404` immediately.

### `POST /workspaces/:wid/monitors/:mid/agent-key` (member)

Agent monitors only. `200 { "data": { …monitor, "agentKey": "pbk_…" } }`, the new key shown once;
reports with the old key get `401` immediately.

### `DELETE /workspaces/:wid/monitors/:mid` (member)

`204`. Cancels the job, deletes its checks, rollups and incidents, removes it from status pages.

### `POST /workspaces/:wid/monitors/:mid/pause` (member)

`200` monitor (`isPaused: true`, `status: "paused"`). Cancels the job and closes an open incident.

### `POST /workspaces/:wid/monitors/:mid/resume` (member)

`200` monitor (`status: "pending"`, counters reset). Reschedules the job (heartbeat: the next ping
is due `expectedEverySec + graceSec` from now). A monitor paused by its budget that is still over
budget → `409 BUDGET_EXCEEDED` ("Raise the monthly budget to resume this monitor").

### `POST /workspaces/:wid/monitors/test` (member, 5/min)

Runs one check of an **unsaved** configuration (same body as create). Not stored.

```json
{
  "data": {
    "ok": true,
    "statusCode": 200,
    "error": null,
    "totalMs": 258.1,
    "timings": { "dnsMs": 75.6, "tcpMs": 36.6, "tlsMs": 57.2, "ttfbMs": 86.5, "downloadMs": 1.1 },
    "sslExpiresAt": "2026-12-25T22:56:35.000Z"
  }
}
```

A failed check is still `200`, e.g. `{ "ok": false, "statusCode": null, "error": "Connection refused", … }`.

### `POST /workspaces/:wid/monitors/:mid/test` (member, 5/min)

Same, for a saved monitor; counted in the monitor's monthly usage. Agent monitors test their
`probeUrl`. Heartbeat monitors, and agent monitors without a probe URL → `400 NOT_SUPPORTED`.

## Monitor analytics

### `GET /workspaces/:wid/monitors/:mid/uptime` (viewer)

```json
{ "data": { "h24": 99.306, "d7": 99.898, "d30": 99.869, "d90": 99.923 } }
```

Percentages with 3 decimals; `null` = no data. 24 h from raw checks, others from daily rollups.

### `GET /workspaces/:wid/monitors/:mid/checks?from&to` (viewer)

ISO dates; default the last 24 h; max range 7 days. Up to 500 raw points:

```json
{ "data": { "downsampled": false, "bucketSec": null, "points": [{ "t": "…", "totalMs": 87.4, "ok": true, "statusCode": 200, "timings": { … } }] } }
```

More points are averaged into equal buckets (a bucket is `ok: false` if any check failed):

```json
{ "data": { "downsampled": true, "bucketSec": 173, "points": [{ "t": "…", "totalMs": 41.2, "maxMs": 66, "ok": true, "upRatio": 1, "count": 17, "timings": { … } }] } }
```

### `GET /workspaces/:wid/monitors/:mid/checks?limit=30` (viewer)

The latest N raw checks (1–200), oldest first. Used by the timing breakdown chart.

### `GET /workspaces/:wid/monitors/:mid/daily?days=90` (viewer)

Exactly `days` entries (≤ 90), oldest first, missing days filled with `uptime: null`:

```json
{
  "data": [
    {
      "date": "2026-10-26",
      "totalChecks": 8640,
      "upChecks": 8631,
      "uptime": 99.896,
      "downtimeSec": 90,
      "avgResponseMs": 41.3,
      "p95ResponseMs": 66.1
    }
  ]
}
```

### `GET /workspaces/:wid/monitors/sparklines?points=30` (viewer)

Recent response times for every monitor of the workspace (last 6 h, up to `points` each):

```json
{ "data": { "66f…": [{ "t": "…", "ms": 87.4, "ok": true }] } }
```

### `GET /workspaces/:wid/monitors/:mid/usage` (viewer)

Requests, cost, budget and interval state of one monitor for the current UTC month:

```json
{
  "data": {
    "month": "2026-10",
    "requests": 1234,
    "estimatedSoFar": 1250,
    "estimatedMonthly": 43200,
    "costPer1kRequests": 0.5,
    "currency": "INR",
    "actualCost": 0.62,
    "estimatedMonthlyCost": 21.6,
    "method": "HEAD",
    "headUnsupported": false,
    "budget": {
      "monthlyRequestBudget": 20000,
      "budgetAction": "slow",
      "usedRatio": 0.062,
      "state": "ok",
      "exceededThisMonth": false
    },
    "pings": 0,
    "reports": 0,
    "requestsSaved": 21600,
    "interval": {
      "adaptive": true,
      "intervalSec": 60,
      "currentIntervalSec": 120,
      "minIntervalSec": 30,
      "maxIntervalSec": 600,
      "slowedByBudget": false
    }
  }
}
```

`requests` = requests PulseBoard sent to your server (checks, HEAD→GET retries and redirect hops,
probes, "Test now"). `pings` (heartbeat) and `reports` (agent) are requests received instead.
`requestsSaved` = requests a month avoided compared with checking every minute (43,200 a month).
Costs are `null` without a price. `budget.state`: `none` | `ok` | `warning` (≥ 80 %) |
`exceeded` (≥ 100 %).

### `GET /workspaces/:wid/monitors/:mid/agent-metrics?from&to` (viewer)

Agent monitors. Default the last hour, max range 24 h, at most 500 points (merged into buckets
when there are more reports):

```json
{
  "data": {
    "points": [
      {
        "t": "…",
        "requests": 166,
        "errors5xx": 0,
        "errors4xx": 2,
        "errorRate": 0,
        "p50Ms": 16.4,
        "p95Ms": 31.7,
        "p99Ms": 32.2
      }
    ],
    "topRoutes": [{ "route": "/api/orders/:id", "requests": 410, "errors5xx": 1, "p95Ms": 95.2 }],
    "lastReport": {
      "hostname": "web-1",
      "agentVersion": "1.0.0",
      "uptimeSec": 86400,
      "windowEnd": "…"
    }
  }
}
```

`errorRate` is the 5xx percentage. Reports are kept for 7 days.

### `GET /workspaces/:wid/monitors/:mid/metrics?range=1h|24h|7d` (viewer)

Health deck data: per monitor type, four metrics, each as a bucketed series plus the value over
the whole window and the change against the previous window. `range` defaults to `24h`; anything
else is `400 VALIDATION_ERROR`; a monitor of another workspace is `404`.

| range | bucket | buckets |
| ----- | ------ | ------- |
| `1h`  | 1 min  | 60      |
| `24h` | 15 min | 96      |
| `7d`  | 2 h    | 84      |

The grid is epoch-aligned and ends with the bucket containing now (partial). Every bucket is in
`series`; a bucket without data has `v: null` (a gap). The previous window is the same length,
directly before `from`. `change` = `(value - previous) / |previous| × 100`, 1 decimal, `null` when
either is `null` or `previous` is 0. `current` is the last non-null bucket; `peak`, `low` and
`average` are over the non-null buckets. `empty` is `true` when the monitor has no data in either
window.

```json
{
  "data": {
    "type": "http",
    "range": "24h",
    "bucketMs": 900000,
    "from": "2026-10-26T12:15:00.000Z",
    "to": "2026-10-27T12:21:40.000Z",
    "empty": false,
    "metrics": [
      {
        "key": "uptime",
        "label": "Uptime",
        "unit": "%",
        "value": 99.93,
        "previous": 99.81,
        "change": 0.1,
        "current": 100,
        "peak": 100,
        "average": 99.94,
        "low": 98.9,
        "series": [{ "t": "2026-10-26T12:15:00.000Z", "v": 100 }]
      }
    ],
    "timings": [
      {
        "t": "2026-10-26T12:15:00.000Z",
        "dnsMs": 3,
        "tcpMs": 10,
        "tlsMs": 20,
        "ttfbMs": 80,
        "downloadMs": 2
      }
    ],
    "live": {
      "lastAt": "2026-10-27T12:21:30.000Z",
      "last": { "t": "2026-10-27T12:15:00.000Z", "n": 4, "ok": 4, "sumMs": 812, "nMs": 4 },
      "range": { "n": 96, "ok": 95, "sumMs": 20112, "nMs": 95 }
    }
  }
}
```

`timings` is for `http` monitors only (`null` otherwise): per-bucket averages over ok checks.
`live` holds accumulators over all check results of the monitor (`ok` checks, and `sumMs`/`nMs` =
sum/count of `totalMs` over ok checks that have one) so a client can fold new checks in.
Rounding: `%` 2 decimals, `ms` integers (agent `p95Latency`: 1 decimal), `req/s` 2 decimals, counts integers. `p95` is approximate.

| type      | key           | unit  | definition                                                                                                                   |
| --------- | ------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| http      | `uptime`      | %     | ok checks / checks                                                                                                           |
| http      | `p95`         | ms    | approximate 95th percentile of `totalMs` over ok checks                                                                      |
| http      | `failed`      | %     | failed checks / checks                                                                                                       |
| http      | `avgResponse` | ms    | mean `totalMs` over ok checks                                                                                                |
| heartbeat | `uptime`      | %     | ok / (pings + missed periods)                                                                                                |
| heartbeat | `missed`      | pings | failures written by the overdue detector; buckets without any result are `null`                                              |
| heartbeat | `lateness`    | ms    | mean of `max(0, gap to the previous ping - expectedEverySec)` per ping (success or `/fail`; one ping before the window used) |
| heartbeat | `duration`    | ms    | mean `totalMs` of pings that carry one (timed `/start` runs)                                                                 |
| agent     | `requestRate` | req/s | requests / bucket seconds (`value`: requests / window seconds)                                                               |
| agent     | `p95Latency`  | ms    | requests-weighted mean of the reports' `p95Ms` (1 decimal)                                                                   |
| agent     | `errorRate`   | %     | 5xx / requests; `null` when there were no requests                                                                           |
| agent     | `uptime`      | %     | ok / checks (agent, probe and external sources)                                                                              |

### `GET /workspaces/:wid/usage?month=YYYY-MM` (viewer)

The Cost & Usage page: the whole workspace for one month (default: the current UTC month).

```json
{
  "data": {
    "month": "2026-10",
    "totals": {
      "monitors": 6,
      "byType": { "http": 4, "heartbeat": 1, "agent": 1 },
      "requests": 51234,
      "estimatedMonthlyRequests": 172800,
      "requestsSaved": 86400,
      "pings": 1440,
      "reports": 43200,
      "costByCurrency": [{ "currency": "INR", "actual": 512.34, "estimatedMonthly": 1728 }]
    },
    "monitors": [
      {
        "id": "…",
        "name": "Checkout API (agent)",
        "type": "agent",
        "status": "up",
        "intervalLabelSec": 30,
        "adaptive": false,
        "currentIntervalSec": null,
        "requests": 12,
        "estimatedMonthlyRequests": 0,
        "requestsSaved": 43200,
        "pings": 0,
        "reports": 1440,
        "costPer1kRequests": null,
        "currency": "INR",
        "actualCost": null,
        "estimatedMonthlyCost": null,
        "budget": { "monthlyRequestBudget": null, "usedRatio": null, "state": "none" }
      }
    ]
  }
}
```

`intervalLabelSec`: http → the current (adaptive) interval, heartbeat → `expectedEverySec`,
agent → `reportEverySec`. Costs are summed **per currency**, never converted.

---

## Push endpoints (no login)

These are called by your systems, not by the dashboard. The secret in the URL or header is the
only authentication. Responses never reveal anything about the monitor.

### `GET|POST /ping/:token` · `/ping/:token/start` · `/ping/:token/fail` (60/min per token)

Heartbeat monitors. Call `/ping/:token` when your job finished successfully, optionally
`/start` when it begins (the next ping then records the run duration), and `/fail` when it ran
and failed (message from `?message=…` or JSON `{ "message": "…" }`, max 500 characters).

```bash
curl -fsS https://pulseboard.example.com/api/v1/ping/<token>
```

`200 { "ok": true }`; paused monitor → `200 { "ok": true, "ignored": "paused" }`; unknown token →
`404`. No ping within `expectedEverySec + graceSec` counts as one failed check per missed period,
and heartbeat monitors open an incident on the **first** failure (and resolve on the first ping).

### `POST /agent/report` (30/min per key)

Sent by `pulseboard-agent` every `reportEverySec`. `Authorization: Bearer <agentKey>`.

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

`202 { "ok": true }`. `401` missing/unknown key, `400` invalid body. A report is a failed check
when the 5xx rate is above `errorRateThreshold` or `p95Ms` is above `p95ThresholdMs`; otherwise
(including zero traffic) it's a successful one. Incidents follow the usual 3 failures / 2
successes. If no report arrives for 2 × `reportEverySec`, the worker probes `probeUrl` (up to 3
HEAD requests, 10 s apart): all fail → incident; one answers → status `degraded` and a one-time
"agent silent" notice.

---

## Incidents

Incident object:

```json
{
  "id": "…",
  "monitorId": "…",
  "monitor": { "id": "…", "name": "Checkout API", "url": "https://api.example.com/health" },
  "workspaceId": "…",
  "startedAt": "2026-10-27T03:00:10.000Z",
  "resolvedAt": "2026-10-27T03:15:10.000Z",
  "durationSec": 900,
  "cause": "Unexpected status 500 (expected 200–399)",
  "timeline": [
    { "at": "…", "type": "opened", "message": "Down after 3 consecutive failed checks: …" },
    { "at": "…", "type": "alert_sent", "message": "Down alert via Discord (#ops) sent" },
    {
      "at": "…",
      "type": "alert_failed",
      "message": "… failed (attempt 1): HTTP 500; retrying in 30s"
    },
    { "at": "…", "type": "resolved", "message": "Recovered: checks are passing again" }
  ]
}
```

### `GET /workspaces/:wid/incidents` (viewer)

Paginated, newest first. Filters: `?status=open|resolved`, `?monitorId=…`.

### `GET /workspaces/:wid/incidents/:iid` (viewer)

`200` incident. Incidents are created and resolved by the worker only; there are no write endpoints.

---

## Alert channels

Channel object: `{ "id", "workspaceId", "name", "type": "discord|slack|email", "target", "isEnabled" }`.
For viewers `target` is masked (`https://discord.com/•••`, `o•••@example.com`).

### `GET /workspaces/:wid/alert-channels` (viewer)

Paginated list.

### `POST /workspaces/:wid/alert-channels` (member)

```json
{ "name": "#ops", "type": "discord", "target": "https://discord.com/api/webhooks/123/abc" }
```

`target` must match the type: a `discord.com/api/webhooks/…` URL, a `hooks.slack.com/services/…`
URL, or an email address. `isEnabled` defaults to `true`.

### `GET /workspaces/:wid/alert-channels/:cid` (viewer)

### `PATCH /workspaces/:wid/alert-channels/:cid` (member)

Any subset, e.g. `{ "isEnabled": false }`. The merged channel is re-validated.

### `DELETE /workspaces/:wid/alert-channels/:cid` (member)

`204`.

### `POST /workspaces/:wid/alert-channels/:cid/test` (member, 5/min)

Sends a test alert immediately.

```json
{ "data": { "delivered": true, "previewUrl": "https://ethereal.email/message/…" } }
```

`previewUrl` is set for emails sent to the Ethereal test inbox (no SMTP configured).
`502 ALERT_DELIVERY_FAILED` with the provider's reason if delivery fails.

---

## Status pages

Status page object: `{ "id", "workspaceId", "slug", "title", "description", "monitorIds": [], "isPublic" }`.

### `GET /workspaces/:wid/status-pages` (viewer)

Paginated list, newest first.

### `POST /workspaces/:wid/status-pages` (member)

```json
{
  "title": "Acme Status",
  "slug": "acme",
  "description": "Live status of Acme services",
  "monitorIds": ["66f…"],
  "isPublic": true
}
```

`slug`: 3–60 lowercase letters, digits and single dashes; `409` with a `slug` field error if
taken. Monitors must belong to the workspace (`400` otherwise); order is kept.

### `GET /workspaces/:wid/status-pages/:pid` (viewer)

### `PATCH /workspaces/:wid/status-pages/:pid` (member)

Any subset. Clears the public cache for the old and new slug.

### `DELETE /workspaces/:wid/status-pages/:pid` (member)

`204`.

### `GET /public/status/:slug` (no auth, cached 30 s)

Only public data: no URLs, ids, headers or error messages. Headers:
`Cache-Control: public, max-age=30`, `X-Cache: HIT|MISS`. A private or unknown page → `404`.

```json
{
  "data": {
    "title": "Acme Status",
    "description": "Live availability of Acme Inc. services",
    "overall": "operational",
    "monitors": [
      {
        "name": "Checkout API",
        "status": "up",
        "uptime90": 99.997,
        "days": [{ "date": "2026-07-30", "uptime": null, "downtimeSec": 0, "totalChecks": 0 }]
      }
    ],
    "incidents": [
      { "monitorName": "Checkout API", "startedAt": "…", "resolvedAt": "…", "durationSec": 900 }
    ],
    "generatedAt": "2026-10-27T09:15:00.000Z"
  }
}
```

`overall`: `operational` | `partial_outage` | `major_outage` | `no_data` (paused monitors ignored).
A `degraded` monitor is shown as `up`. No URLs, ping tokens, agent keys or probe URLs, for any type.

---

## Realtime (Socket.io)

Connect to the API origin with the access token:

```js
import { io } from 'socket.io-client';
const socket = io('https://api.example.com', { auth: (send) => send({ token: accessToken }) });
```

Invalid/expired token → `connect_error` with message `unauthorized` (refresh, then reconnect).
On connect the socket joins one room per workspace the user belongs to.

| Client → server   | Payload | Purpose                                                       |
| ----------------- | ------- | ------------------------------------------------------------- |
| `workspaces:sync` | ack fn  | Re-join rooms after joining/leaving a workspace → `{ rooms }` |

| Server → client     | Payload                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:result`      | `{ monitorId, workspaceId, status, isPaused, lastCheckedAt, lastResponseMs, lastOk, lastStatusCode, lastError, lastTimings, sslExpiresAt, adaptive, currentIntervalSec, pausedReason, budgetExceededMonth, lastPingAt, nextDueAt, lastReportAt, silenceState }` |
| `incident:opened`   | `{ id, monitorId, workspaceId, startedAt, resolvedAt: null, durationSec: null, cause }`                                                                                                                                                                         |
| `incident:resolved` | same, with `resolvedAt` and `durationSec`                                                                                                                                                                                                                       |
| `incident:updated`  | same; sent when the timeline changes (e.g. an alert was sent)                                                                                                                                                                                                   |
