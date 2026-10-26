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
| 409  | `CONFLICT`, `LAST_OWNER`                                       | Duplicate (email, slug, member); last owner protection |
| 413  | `PAYLOAD_TOO_LARGE`                                            | Body over 100 kB                                       |
| 429  | `RATE_LIMITED`                                                 | Rate limit hit (see below)                             |
| 502  | `ALERT_DELIVERY_FAILED`                                        | Test alert couldn't be delivered                       |
| 500  | `INTERNAL`                                                     | Unexpected error (details are logged, not returned)    |

**Roles.** `viewer` (read) < `member` (+ monitors, alert channels, status pages) < `owner`
(+ members, workspace settings). The minimum role is listed for each workspace endpoint.

**Rate limits.** login/register: 20 per 15 min per IP · refresh: 60 per 15 min per IP ·
"Test now": 5 per min per user · test alert: 5 per min per user · public status: 120 per min per IP.

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

`200`, same response shape as register. Wrong password and unknown email both return
`401 INVALID_CREDENTIALS`.

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
    "user": { "id": "66f…", "name": "Ada Lovelace", "email": "ada@example.com" },
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
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `GET /workspaces/:wid/monitors` (viewer)

Paginated, newest first. Optional `?status=up|down|pending|paused`.

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

Only `name`, `url` and `intervalSec` are required. Rules: `intervalSec` ≥ 30 (≥ 10 in DEMO_MODE),
≤ 86400; `timeoutMs` 1000–30000 and ≤ interval; `method` GET/HEAD/POST; `Host`, `Content-Length`
and similar headers can't be set. `201` monitor (status `pending`); its check job is scheduled
and runs right away. `400 UNSAFE_TARGET` for private/loopback/metadata addresses (unless
`ALLOW_PRIVATE_TARGETS=true`).

### `GET /workspaces/:wid/monitors/:mid` (viewer)

`200` monitor.

### `PATCH /workspaces/:wid/monitors/:mid` (member)

Any subset of the create fields, e.g. `{ "intervalSec": 60 }`. Merged with the stored monitor
and re-validated as a whole; the job is rescheduled with the new interval.

### `DELETE /workspaces/:wid/monitors/:mid` (member)

`204`. Cancels the job, deletes its checks, rollups and incidents, removes it from status pages.

### `POST /workspaces/:wid/monitors/:mid/pause` (member)

`200` monitor (`isPaused: true`, `status: "paused"`). Cancels the job and closes an open incident.

### `POST /workspaces/:wid/monitors/:mid/resume` (member)

`200` monitor (`status: "pending"`, counters reset). Reschedules the job.

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

Same, for a saved monitor.

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

| Server → client     | Payload                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:result`      | `{ monitorId, workspaceId, status, isPaused, lastCheckedAt, lastResponseMs, lastOk, lastStatusCode, lastError, lastTimings, sslExpiresAt }` |
| `incident:opened`   | `{ id, monitorId, workspaceId, startedAt, resolvedAt: null, durationSec: null, cause }`                                                     |
| `incident:resolved` | same, with `resolvedAt` and `durationSec`                                                                                                   |
| `incident:updated`  | same; sent when the timeline changes (e.g. an alert was sent)                                                                               |
