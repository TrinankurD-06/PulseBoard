# Design decisions

A running log of non-obvious choices: what was chosen, the alternatives, and why.
Newest phase at the bottom.

---

## Phase 1: Foundation

### D1. npm workspaces monorepo with a `shared` package

- **Chosen:** one repo, `apps/*` (api, worker, client, demo-target) + `packages/shared`.
- **Alternatives:** separate repos; Turborepo/Nx.
- **Why:** the API and worker must use _identical_ Mongoose models and business rules
  (incident state machine, uptime maths). A shared package makes that a single source of
  truth. Plain npm workspaces are enough at this size; Turborepo would add build caching
  we don't need, since nothing is compiled except the client.
- `shared` uses an `exports` map with subpaths (`/constants`, `/schemas`, `/models`, …) so
  the browser bundle can import constants and Zod schemas without pulling in Mongoose.

### D2. API and worker are separate processes that only talk through MongoDB

- **Why:** a slow or crashing check can never block HTTP requests, and each side scales
  independently. MongoDB is the only shared dependency: Agenda jobs are the "queue", change
  streams are the "pub/sub". This keeps the project pure MERN (no Redis/RabbitMQ).

### D3. Express 5 (not 4)

- **Why:** Express 5 forwards rejected promises from async handlers to the error handler
  natively, so no `express-async-errors`/wrapper boilerplate.
- **Consequence:** `req.query` is a read-only getter, so the `validate` middleware stores
  parsed values on `req.valid` instead of overwriting `req.query`.

### D4. Hand-written Mongo-operator sanitiser instead of `express-mongo-sanitize`

- `express-mongo-sanitize` reassigns `req.query`, which throws on Express 5.
- `sanitizeBody` recursively drops keys starting with `$` or containing `.` from JSON bodies.
- Query strings are already safe: Express 5's default "simple" parser never builds nested
  objects, so `?email[$ne]=x` is just a string key. Zod schemas then whitelist fields.
  Two layers: sanitising (defence in depth) + validation (the real contract).

### D5. One error shape: `{ error: { code, message, details? } }`

- `AppError` = expected, client-facing errors (status + machine-readable code).
- Zod errors → 400 `VALIDATION_ERROR` with per-field details; duplicate key (11000) → 409;
  bad ObjectId cast → 400; body-parser errors → 400/413.
- Anything else is a bug: logged with stack, returned as a generic 500 so internals never leak.

### D6. Zod-validated environment, fail fast

- Each process parses `process.env` with a Zod schema at startup and refuses to boot with a
  readable list of problems. Better a clear crash at deploy time than `undefined` secrets at
  runtime. Locally, `.env` at the repo root is loaded with dotenv; in production the platform
  injects variables.

### D7. pino + pino-http with request IDs

- pino is JSON-first and very fast (logging off the hot path). Each request gets an id
  (reusing an upstream `x-request-id` if a proxy set one), echoed in the response header and
  attached to every log line for that request, so a user-reported error can be traced.
- Auth headers/cookies and password fields are redacted.

### D8. CORS with an origin _array_

- With `origin: 'https://x'` the `cors` package sends that header to every caller and relies
  on the browser to compare. With `origin: ['https://x']` it only sends the header when the
  request origin matches, so the API's response is explicit. `credentials: true` is needed for
  the refresh cookie.

### D9. Local MongoDB as a single-node replica set

- Change streams (and transactions) only work on replica sets. `docker-compose.yml` runs
  `mongod --replSet rs0`; its healthcheck runs `rs.initiate()` on first start.
  `directConnection=true` in the URI lets the driver connect from the host even though the
  member is registered as `localhost:27017` inside the container.
- Tests use `MongoMemoryReplSet` for the same reason, so test behaviour matches prod.

### D10. Indexes (and why each exists)

| Collection    | Index                                                     | Serves                                                          |
| ------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| users         | `email` unique                                            | login lookup; prevents duplicate accounts                       |
| workspaces    | `slug` unique                                             | URL-friendly unique names                                       |
| memberships   | `{workspaceId, userId}` unique                            | RBAC check on every request; one role per user per workspace    |
| memberships   | `{userId}`                                                | "my workspaces" list, socket room joins                         |
| sessions      | `tokenHash` unique                                        | refresh-token lookup                                            |
| sessions      | `{familyId}`                                              | revoke a whole token family on reuse                            |
| sessions      | `{expiresAt}` TTL                                         | MongoDB deletes expired sessions automatically                  |
| monitors      | `{workspaceId, createdAt: -1}`                            | dashboard list                                                  |
| monitors      | `{isPaused}`                                              | worker reconcile on boot                                        |
| checkresults  | `{meta.monitorId, timestamp: -1}`                         | chart range queries per monitor                                 |
| dailyrollups  | `{monitorId, date}` unique                                | 90-day bars; `$merge` upsert key                                |
| incidents     | `{workspaceId, resolvedAt, startedAt: -1}`                | incidents page (open/resolved filter, newest first)             |
| incidents     | `{monitorId, startedAt: -1}`                              | monitor detail + status page history                            |
| incidents     | `{monitorId}` unique, partial `resolvedAt: {$type: null}` | **DB-level guarantee of at most one open incident per monitor** |
| alertchannels | `{workspaceId, isEnabled}`                                | enabled channels on incident open/resolve                       |
| statuspages   | `slug` unique, `{workspaceId}`                            | public lookup by slug; workspace list                           |

- The partial unique index on incidents is a safety net behind the atomic counter update in
  the worker (phase 5): even if two checks race, the second insert fails with 11000 instead of
  creating a duplicate incident. `$type: 'null'` matches only incidents whose `resolvedAt`
  is explicitly null (open), and is an operator partial indexes support.
- `agendaJobs` indexes are created in phase 4 with the scheduler.

### D11. CheckResult is a time-series collection

- `timeField: timestamp`, `metaField: meta {monitorId, workspaceId}`, `granularity: seconds`,
  `expireAfterSeconds: 7 days`. MongoDB stores results in compressed buckets per monitor, so
  millions of checks stay small and range scans are fast. The TTL deletes raw data after 7 days;
  long-term history lives in `DailyRollup`.
- `ensureCollections()` runs `Model.init()` for every model at startup. This matters because
  an insert into a non-existent collection would create a _regular_ collection, silently
  losing the time-series layout. A test asserts the collection type.

### D12. `Session` model added (not in the original spec)

- Refresh-token rotation and logout need server-side state. Only a SHA-256 hash of the token is
  stored; tokens from one login share a `familyId`, so presenting an already-rotated token
  (likely theft) revokes the whole family. Implemented in phase 2.

### D13. Monitor stores `lastStatusCode` and `lastError` in addition to the spec's `last*` fields

- So the live dashboard can show _why_ a monitor is failing without an extra request.

### D14. Tailwind v4 with class-based dark mode, dark by default

- `@custom-variant dark` keyed on a `.dark` class on `<html>`. An inline script in
  `index.html` applies the saved theme before first paint (no flash). Status colours are
  defined once as theme tokens (`--color-status-up/down/pending/paused`).

### D15. Vite dev proxy for `/api`

- In dev the client calls `/api/v1/...` on its own origin and Vite proxies to `:4000`; in
  production a Vercel rewrite does the same. The refresh cookie is therefore always
  first-party (`SameSite=Lax`), avoiding third-party-cookie blocking in Safari/Chrome.
  Socket.io connects to the API directly; it authenticates with the access token, not cookies.

---

## Phase 2: Auth & RBAC

### D16. Access token in memory, refresh token in an httpOnly cookie

- **Access token** (JWT, 15 min) is returned in the JSON body and kept only in a JS variable,
  never `localStorage`. XSS can't steal a stored token, and if one leaks it dies in 15 minutes.
- **Refresh token** (JWT, 7 days) lives in an `httpOnly` cookie that JavaScript can't read.
  It is scoped with `Path=/api/v1/auth`, so the browser only sends it to auth endpoints, and
  it is `Secure` in production.
- After a page reload the access token is gone; `AuthProvider` silently calls `/auth/refresh`
  to get a new one. That's why the app shows a spinner for a moment on load.
- **Alternatives:** both tokens in `localStorage` (simple, but XSS-stealable); a server-side
  session cookie only (simplest, but the spec asks for JWT and Socket.io auth is easier with a
  bearer token).

### D17. Refresh-token rotation with reuse detection (`Session` collection)

- Every refresh token is single-use. `/auth/refresh` marks the presented token's session as
  revoked and issues a new token in the same **family** (one family = one login).
- If a token that was **already used** is presented again, someone has a copy of it (theft)
  or there was a race. Either way the whole family is revoked and the user must log in again.
  This limits a stolen refresh token to at most one use before the real user's next refresh
  exposes it.
- The "claim" is atomic: `findOneAndUpdate({ _id, revokedAt: null }, { revokedAt: now })`.
  Two concurrent refreshes with the same token can't both win.
- Only the SHA-256 hash of the token is stored, like a password, so a database dump doesn't
  contain usable tokens. A TTL index on `expiresAt` removes old sessions automatically.
- Refresh tokens are signed with a **different secret** from access tokens, so one can never
  be used as the other (there's a test for this).

### D18. The client sends at most one refresh at a time

- Because refresh tokens are single-use, two parallel refreshes (e.g. several queries all
  getting a 401 at once, or React StrictMode running effects twice) would look like reuse and
  log the user out. `refreshAccessToken()` shares one in-flight promise between all callers.
- The axios interceptor retries a failed request **once** after refreshing. If the refresh
  also fails, the session is over: the token is dropped, the query cache is cleared, and
  `ProtectedRoute` redirects to `/login`.
- Known limit: two browser _tabs_ refreshing in the same instant can still trip reuse
  detection, since they don't share memory. The cost is a re-login; a cross-tab lock
  (BroadcastChannel) would fix it if it ever mattered.

### D19. RBAC: ranked roles + per-route `requireRole`

- Roles are ordered `viewer (1) < member (2) < owner (3)`. `requireRole('member')` passes for
  members and owners. One `hasRole()` function in `shared` is used by the API (enforcement)
  and the client (hiding buttons), so the two can't disagree.
- `requireRole` looks up the caller's `Membership` for `:wid` (an indexed lookup on
  `{workspaceId, userId}`) and attaches it to `req.membership`.
- **Non-members get 404, not 403.** A 403 would confirm that the workspace id exists. Members
  with too low a role get 403 with a message saying which role is needed.
- The client hides actions the user can't take, but that's just UX: the server checks every
  request on its own.

### D20. A workspace always keeps at least one owner

- Demoting or removing the last owner returns `409 LAST_OWNER`; otherwise nobody could manage
  the workspace again.
- **Known edge case:** two owners demoting _each other_ at the same instant could both pass the
  check (each sees two owners), a classic "write skew". Fixing it means running both writes in
  a transaction that also writes a shared document (e.g. a counter on the workspace), so one
  aborts. Not worth the complexity for this project; noted here as a trade-off.

### D21. Transactions where they're possible

- **Registration** creates the user, a personal workspace and the owner membership in one
  transaction. A user without a workspace would land on an empty, broken app.
- **Workspace deletion** can't be one transaction, because MongoDB doesn't allow writes to
  time-series collections inside transactions. Instead children are deleted first and the
  workspace document last. If something fails halfway, the workspace still exists and the
  delete can simply be run again.

### D22. Login doesn't reveal which emails have accounts

- Wrong password and unknown email return the same error and status. For unknown emails,
  bcrypt still compares against a dummy hash so both cases take about the same time, and the
  response time doesn't leak whether the account exists.
- Passwords are capped at 72 characters because bcrypt ignores everything past 72 bytes;
  accepting longer ones would give a false sense of security.
- bcrypt cost is 12 in production (about 250 ms per hash) and 4 in tests (same code path,
  much faster suite). It's configurable via `BCRYPT_COST`.

### D23. Rate limiting

- `/auth/login` and `/auth/register`: 20 requests per IP per 15 minutes (`AUTH_RATE_LIMIT_MAX`).
  `/auth/refresh` gets 3× that, since the client calls it automatically.
- Limits return the standard error shape with code `RATE_LIMITED` (HTTP 429) and the
  `RateLimit` headers.
- Counters live in process memory. With one API instance that's exact; with several, each
  would count separately. No Redis by design; `rate-limit-mongo` would be the MERN-only
  fix if needed.
- `TRUST_PROXY=true` must be set on Render so the limiter sees the real client IP, not the
  proxy's.

### D24. "Invite by email" adds an existing account

- `POST /workspaces/:wid/members { email, role }` adds a user who already has a PulseBoard
  account. If no account uses that email, the API explains that they need to sign up first.
- A real invitation flow (emailed token, pending invites) would need its own collection and
  email sending. It's a possible extension, but out of scope for the spec.

### D25. Response envelope

- Single resources: `{ data: {...} }`. Lists: `{ data: [...], pagination: { page, limit, total,
totalPages } }`. Errors: `{ error: {...} }`. The client always reads `res.data.data`.

---

## Phase 3: Monitors CRUD

### D26. Services depend on a scheduler _interface_, not on Agenda

- Monitor and workspace services only call `scheduler.scheduleMonitor(monitor)` and
  `scheduler.cancelMonitor(id)`. `createApp({ scheduler })` receives the implementation.
- **Why:** the monitor code doesn't change when Agenda arrives (phase 4); tests pass a fake
  that records calls, so "job created on create / cancelled on pause and delete" is checked
  quickly and without timing; and the scheduler could be swapped later without touching
  business logic (dependency injection).

### D27. SSRF protection in two layers

1. **When a monitor is saved** (`assertSafeUrl`): only `http(s)`, no `user:pass@` in the URL,
   and _every_ address the hostname resolves to must be public. One private record among
   several is enough to reject it, since the client could connect to any of them.
2. **When the check connects** (`createSafeLookup`, used by the check runner in phase 4): a
   custom DNS `lookup` passed to `http.request` rejects private addresses at the moment the
   socket connects. This defeats **DNS rebinding**, where a name resolves to a public IP
   at validation time and to `127.0.0.1` later. The address we check is exactly the one used.

- Blocked: `0/8, 10/8, 100.64/10, 127/8, 169.254/16` (cloud metadata), `172.16/12,
192.168/16`, multicast/reserved, and IPv6 `::, ::1, fc00::/7, fe80::/10, ff00::/8`.
  IPv4-mapped IPv6 (`::ffff:127.0.0.1`, `::ffff:7f00:1`) is unwrapped first; that's a
  classic bypass.
- Uses Node's built-in `net.BlockList` for CIDR matching instead of hand-written bit maths.
- Anything that isn't a valid IP counts as private ("fail closed").
- `ALLOW_PRIVATE_TARGETS=true` turns it off for the local demo-target only.

### D28. One Zod schema for client and API, built by a factory

- `buildMonitorSchemas({ demoMode })` returns `create`/`update` schemas, since the minimum
  interval depends on `DEMO_MODE` (10 s vs 30 s). The client form uses the same `create`
  schema (via `z.preprocess` to turn its header rows into an object), so client and server
  rules can't drift. `GET /api/v1/meta` tells the client which mode the server is in.
- **PATCH = merge, then validate the whole thing.** The update schema accepts any subset of
  fields; the service merges it with the stored monitor and re-parses the result with
  `create`. Cross-field rules (timeout ≤ interval) therefore hold even when only one of the
  two fields changes.
- **Zod 4 gotcha (caught by a test):** `.default()` values are applied even inside
  `.partial()`, so a PATCH of `{ name }` would have silently reset `method`, `timeoutMs` and
  `expectedStatus`. The base fields have no defaults; only `create` adds them.
- The URL check uses `abort: true` so a malformed URL reports one error, not two.

### D29. Workspace scoping and secret headers

- Every monitor lookup filters by `{ _id, workspaceId }`, never `_id` alone, so a monitor id
  from another workspace is simply "not found", even for a valid member of _some_ workspace.
- Custom headers often carry API keys. Viewers see header _names_ but values are masked
  (`••••••`); members and owners see real values because they need them to edit.

### D30. Lifecycle rules

- **Create:** status `pending` until the first check.
- **Pause:** `status = paused` and the job is cancelled; nothing runs while paused.
- **Resume:** counters reset, `status = pending`, job scheduled again. Starting fresh avoids
  a stale "2 of 3 failures" from before the pause tipping the monitor into an incident.
- **Delete:** the job is cancelled _first_, so no check runs against a half-deleted monitor;
  then check results, rollups and incidents are removed and the monitor is pulled from
  status pages.
- **Delete workspace:** cancels every monitor job before deleting any data.
- **Timeout must not exceed the interval**, so checks of one monitor never overlap.

---

## Phase 4: Worker & checks

### D31. Agenda v6 with `@agendajs/mongo-backend`

- Agenda v6 (actively maintained, 2026 releases) moved storage into pluggable backends; the
  MongoDB backend keeps jobs in the `agendaJobs` collection, so **MongoDB is the job queue**.
  (The older `agenda@5` line and the `@hokify/agenda` fork were the alternatives.)
- Agenda gets its **own connection** (`address: MONGODB_URI`) instead of reusing Mongoose's.
  Mongoose 9 bundles a different patch version of the `mongodb` driver than the one the
  backend resolves, and passing driver objects across versions is fragile. The cost is one
  extra small connection pool per process.
- **The API creates jobs but never calls `agenda.start()`**, so it never runs a check. The
  worker defines the handlers and calls `start()`. They share nothing but the database.

### D32. Exactly one `run-check` job per monitor

- Scheduling uses `create('run-check', { monitorId }).repeatEvery('N seconds')
.unique({ 'data.monitorId': id }).save()`, an **upsert**. Saving again (interval
  change, resume) updates the existing job instead of adding a second one.
- A **partial unique index** on `agendaJobs { data.monitorId }` (only for `name: 'run-check'`)
  makes the database itself reject a duplicate, even if two processes upsert at the same moment.
- **Reconcile on worker boot:** create missing jobs, fix wrong intervals, delete orphans
  (deleted or paused monitors) and duplicates. Safe to run repeatedly (a test runs it twice).
- **Self-healing orphans:** if a job runs for a monitor that no longer exists, the handler
  cancels its own job. Agenda's post-run save is an update by `_id` without upsert, so a job
  deleted while it was running stays deleted (checked in Agenda's source).

### D33. Locking: why two workers never double-run a check

- When a worker picks a due job it atomically sets `lockedAt` (find-and-modify). Other
  workers only take jobs that are unlocked or whose lock has expired.
- **Verified end to end:** two worker processes, two monitors at a 10 s interval → 4 checks
  per monitor in ~32 s (one worker alone would also do 4). Double runs would have shown 8.
- `defaultLockLifetime` = 60 s, twice the 30 s maximum check timeout. If it were shorter than
  a slow check, Agenda would assume the worker died and hand the job to another worker → a
  duplicate check.
- On SIGTERM the worker calls `agenda.stop()`, which **unlocks** its jobs so another worker
  can take them immediately instead of waiting up to 60 s for the lock to expire.
- `processEvery: '5 seconds'` means a new job can wait up to 5 s before the first check. The
  backend also offers change-stream notifications to remove that delay; polling is simpler
  and plenty fast for uptime checks.
- Worker `/health` reports `overdueJobs` (due but unlocked). A number that keeps growing
  means the workers can't keep up, which is the signal to add another worker.

### D34. The check runner (Node's `http`/`https`, no HTTP library)

- `agent: false` = a fresh TCP (and TLS) connection on every check. With keep-alive, later
  checks would reuse the connection and DNS/TCP/TLS would show as 0 ms.
- Timings come from `process.hrtime.bigint()` (monotonic, nanosecond resolution) at socket
  events:

  | Phase    | From → to                                        |
  | -------- | ------------------------------------------------ |
  | DNS      | request start → `lookup` (0 for IP-literal URLs) |
  | TCP      | after DNS → `connect`                            |
  | TLS      | `connect` → `secureConnect` (0 for plain HTTP)   |
  | TTFB     | connection ready → `response` (headers received) |
  | Download | `response` → `end`                               |

- **Timeout** is one deadline for the whole check, shared across redirects.
- **Redirects:** up to 3, resolved relative to the current URL, http(s) only; 303 (and
  301/302 after POST) continue as GET, like browsers. `totalMs` covers all hops; the
  timing breakdown is for the final response.
- **Body:** read only when a keyword is set, capped at **1 MB**, after which the download is
  aborted. A keyword beyond the first 1 MB counts as missing (tested).
- **TLS certificate:** `valid_to` of the peer certificate is stored as `sslExpiresAt` (UI
  badge: amber within 14 days, red when expired). Invalid certificates fail the check.
- **Never throws:** every outcome (timeout, refused, DNS failure, bad status) comes back as
  data with a plain-language `error`, because a failed check is a normal result, not a bug.
- `evaluateCheck()` (status range, then keyword) is a separate pure function with its own
  unit tests.

### D35. SSRF checked again when the check runs

- Node skips DNS lookup for IP-literal URLs, so the safe `lookup` can't see them; those are
  checked explicitly before connecting. Every redirect hop goes through the same guards,
  so a public URL that redirects to `http://169.254.169.254/` is blocked.

### D36. "Test now" runs in the API, not through Agenda

- The user is waiting for an answer, so a queue round-trip (up to 5 s of polling) makes no
  sense. The result is **not stored**, so test clicks can't skew uptime or open incidents.
- Two endpoints: `POST /monitors/test` (unsaved form settings) and `POST /monitors/:mid/test`
  (a saved monitor). The spec named only the second; the form needs the first. They share one
  limiter: **5 per minute per user** (keyed by user id, not IP, since it's an authenticated
  action). Member role required, because it makes our server send requests.

### D37. Temporary rules until phases 5 and 6

- Until the incident state machine (phase 5) lands, a monitor's status is simply the last
  check's result. Phase 5 replaces this with "3 failures → down, 2 successes → up".
- Until Socket.io (phase 6), the dashboard and monitor page poll every 15 s.

### D38. Demo target

- Modes: `up` (200 + "healthy"), `down` (connection dropped, like a crashed server), `slow`
  (~3 s, still up, so response time spikes), `error500`, `missing-keyword` (200 but
  degraded body). Verified end to end: each mode produced the expected status and error.
- Default port **4011** instead of the spec's 4001: on this machine VS Code already holds
  4001, and requests went to VS Code instead (found during end-to-end testing). Configurable
  via `DEMO_TARGET_PORT`; it now exits with a clear message if its port is taken.
- `/admin` has no authentication, on purpose: it's a demo prop, not a product feature.
  Nothing real is behind it.

---

## Phase 5: Incidents & alerts

### D39. The state machine is a pure function; the database applies it with guards

- `packages/shared/src/incident/stateMachine.js`: `nextMonitorState(state, ok)` and
  `decideTransition(counters)`, with no I/O, so every rule has a unit test (13 tests, including
  flapping, a failure mid-recovery, repeated outages and paused monitors).
- Rules: `pending → up` on the first success; `pending/up → down` on the **3rd consecutive**
  failure (open incident); `down → up` on the **2nd consecutive** success (resolve). Anything
  below a threshold leaves the status alone, so one blip, or a flapping endpoint that never
  fails 3 times in a row, never pages anyone.

### D40. Concurrency: two checks of one monitor can't open two incidents

Three layers, each enough on its own for its job:

1. **Atomic counting.** The check result is applied in one `findOneAndUpdate` with an
   **aggregation-pipeline update**: MongoDB computes `consecutiveFailures + 1`, resets the other
   counter, and sets `failingSince` only if this is the first failure of a streak, all from the
   document's current values in one write. No read-modify-write window.
2. **Guarded transition.** The status change is a second `findOneAndUpdate` whose filter repeats
   the precondition (`TRANSITION_GUARDS`, exported next to the state machine so the two can't
   drift), e.g. `{ status: { $nin: ['down','paused'] }, consecutiveFailures: { $gte: 3 } }`. If
   two workers race, only one matches; the other gets `null` and does nothing. **Only the winner
   opens the incident and queues alerts.**
3. **Database safety net.** A partial unique index allows only one incident with
   `resolvedAt: null` per monitor; a duplicate insert fails with 11000 and is ignored.

- **Tested:** 8 failing checks of one monitor processed concurrently → counters reach 8,
  exactly one `open_incident`, one incident, one alert per channel.
- User-derived values in the pipeline (error messages) are wrapped in `$literal`, so an error
  text like `"$consecutiveFailures"` is stored as text, not evaluated as a field path (tested).

### D41. Incident times reflect the real outage

- `startedAt` = time of the **first failed check** of the streak (`failingSince`), not the 3rd
  check that confirmed it. `resolvedAt` = the **first good check** (`recoveringSince`), not the
  2nd that confirmed recovery. So `durationSec` is the true outage length (verified end to end:
  error500 for ~40 s → `durationSec: 40`).
- `cause` = the error of the first failed check (`failingCause`).

### D42. Alerts are Agenda jobs with our own retry/backoff

- On open/resolve, one `send-alert { incidentId, channelId, kind, attempt }` job per **enabled**
  channel is queued with `agenda.now()`. Alert sending never slows down checking, and an outage
  of Discord can't block anything else.
- On failure the handler logs `alert_failed` in the timeline and schedules a **new** job:
  **30 s → 2 min → 8 min**, then gives up. Reading of the spec: the initial send plus up to
  3 retries using those three delays. Delivery errors are caught, never thrown, so Agenda's own
  retry logic doesn't stack on top of ours.
- **No duplicate alerts:** after a successful send the key `"channelId:kind"` is added to the
  incident's `deliveredAlerts` and checked before sending. A re-run job (e.g. after a crash)
  can't notify a channel twice, and the state machine guarantees one "down" per incident
  (the spec's "cooldown").
- `removeOnComplete: true` deletes finished one-off jobs so `agendaJobs` doesn't grow forever
  (repeating check jobs are unaffected).
- Every send and failure is recorded in the incident **timeline** (an extra event type,
  `alert_failed`, alongside the spec's `opened / alert_sent / resolved`).

### D43. Alert content is built once, formatted per channel

- `buildAlert()` produces channel-neutral content (title, summary, fields, dashboard link);
  `discordPayload` (embed with a red/green bar), `slackPayload` (Block Kit with an "Open
  dashboard" button) and `renderEmail` (inline-styled HTML + plain text) only format it.
  Each is unit-tested; email output escapes HTML from monitor names.
- Senders live in `shared/alerts` because both the worker (incidents) and the API ("send test
  alert") need them. They're injected (`createApp({ alertSenders })`), so tests use fakes and
  never hit the network.
- **Email in development:** with no `SMTP_HOST`, Nodemailer creates a free **Ethereal** test
  inbox. Nothing reaches a real person, and each message's preview URL is written to the
  incident timeline (shown as a clickable link in the UI). With SMTP settings, real email is sent.

### D44. Alert channel safety

- Webhook URLs are validated against the real hosts (`discord.com/api/webhooks/...`,
  `hooks.slack.com/services/...`). Besides catching typos, this means "send alert" can't be
  used to make our servers POST to arbitrary internal URLs (SSRF). Requests also use
  `redirect: 'error'` and a 10 s timeout.
- Webhook URLs and emails are secrets-ish: **viewers see them masked**
  (`https://discord.com/•••`, `o•••@example.com`); members and owners see them in full.
- PATCH re-validates the merged channel, so switching `type` to `email` while the target is
  still a Discord URL is rejected.
- "Send test alert" is limited to 5 per minute per user and returns `502
ALERT_DELIVERY_FAILED` with the provider's reason when delivery fails.

### D45. Pausing closes an open incident

- No checks run while paused, so an open incident could never recover on its own and would
  stay "ongoing" forever. Pausing resolves it with the timeline entry "Closed because
  monitoring was paused" and sends **no** recovery alert (nothing actually recovered).

---

## Phase 6: Realtime & analytics

### D46. Live updates: MongoDB change streams → Socket.io (no message broker)

- The worker only writes to MongoDB. The API opens two change streams
  (`fullDocument: 'updateLookup'`) and turns events into Socket.io messages:
  - `monitors`: updates touching `lastCheckedAt` or `status` → `check:result`
  - `incidents`: insert → `incident:opened`; update setting `resolvedAt` → `incident:resolved`;
    other updates (alert sent) → `incident:updated`
- `$match` pipelines run **on the server**, so the API never receives irrelevant events
  (e.g. renaming a monitor: tested).
- **Why not watch `checkresults`?** Time-series collections don't support change streams.
  That's why the worker copies each result onto the Monitor document (`last*` fields).
- The payload whitelists fields: custom headers (possibly API keys) never reach a socket.
- Verified with the worker's real pipeline-style updates: in a browser test the dashboard
  turned red 29 s after the demo target broke, with no page reload.

### D47. Resume tokens + retry with backoff

- After each event, the stream's resume token is saved in `streamCheckpoints` (batched:
  at most one write per second per stream). On restart the stream continues with
  `resumeAfter`, so **nothing written while the API was down is lost** (tested: stop,
  write, restart → the missed event arrives).
- Events older than 2 minutes on arrival (replayed after a long outage) advance the token
  but aren't pushed to browsers: stale "live" updates would only confuse.
- On a stream error: log, close, reopen with exponential backoff (1 s → 2 s → … → 30 s).
  If the token is too old for the oplog (codes 260/280/286), the checkpoint is dropped and
  the stream restarts from "now".
- `/health` reports each stream's state (`connecting | live | retrying | stopped`); the API
  is "degraded" (still HTTP 200) when a stream isn't live, because REST still works.

### D48. Socket.io authentication and rooms

- The handshake carries the same 15-minute access token as REST (`auth.token`); invalid →
  `connect_error('unauthorized')`. The client then refreshes once and reconnects.
- On connect the server joins the socket to `workspace:<id>` for each membership, and the
  server only ever emits to those rooms, so **a user can't receive another workspace's
  events** (tested). The client emits `workspaces:sync` after creating/joining a workspace.
- Trade-offs: an open socket isn't cut off when its token expires mid-connection, and a
  member removed from a workspace keeps receiving its events until reconnect or sync.
  Acceptable here; a production system would re-check periodically.
- **Multiple API instances** would each run their own change streams and each emit every
  event to its own sockets. That's correct (each browser is connected to one instance) but
  duplicates the stream work. Fine for one API instance; at scale, use the Socket.io
  MongoDB adapter or partition streams.

### D49. The client patches its cache instead of refetching

- `check:result` updates the cached monitor list and detail in place (`setQueryData`) and
  appends a point to the dashboard sparkline, so no request is made per check. Only queries
  that are actually on screen (charts of an open monitor page) are invalidated and refetched.
- While the socket is connected, queries don't poll at all; if it drops (or a network blocks
  websockets), they fall back to polling every 30 s and the sidebar shows "Offline". After a
  reconnect everything is refetched once to catch up.

### D50. Daily rollups with `$merge`

- `rollupDay(day)`: one aggregation over that UTC day's raw checks → per monitor
  `totalChecks`, `upChecks`, `avgResponseMs`, `p95ResponseMs` (`$percentile`, MongoDB 7+) →
  `$merge` into `dailyrollups` **on the unique `{monitorId, date}` index**. Re-running it
  overwrites the same rows (idempotent, tested).
- `downtimeSec` comes from **incident overlap** with the day (an incident 23:50–00:10
  contributes 10 min to each day), more accurate than "failed checks × interval".
- `rollup` runs every 15 min (today, not final). `finalize-rollup` runs at 00:05 UTC
  (yesterday, final). The 15-minute job also finalises yesterday if the nightly run was
  missed (no worker at 00:05), so the 90-day bars never get a hole. `agenda.every()` upserts
  one job per name, so several workers still produce one schedule.

### D51. Where each uptime number comes from

- **24 h:** raw checks (exact). **7/30/90 days:** rollups, because raw checks expire after
  7 days. Today's rollup is ≤15 minutes old.
- Long windows are **weighted by number of checks**, not an average of daily percentages
  (a day with 10 checks must not weigh as much as a day with 8,640: tested).
- "No data" is `null`, never 100%: a monitor created yesterday must not claim 90 days of
  perfect uptime. The 90-day bars draw those days grey.

### D52. Chart data stays small

- `/checks?from&to`: up to 500 points raw; above that, MongoDB groups them into equal
  `$dateTrunc` buckets (e.g. 24 h → 173 s buckets). A bucket counts as failed if **any**
  check in it failed, so outages are never averaged away. Range is capped at 7 days (raw
  data TTL); longer periods use `/daily`.
- `/monitors/sparklines` returns recent points for **all** monitors in one aggregation
  instead of one request per dashboard card.
- Gotcha found by a test: inside `$group`, `$round` is parsed as an accumulator and can't
  wrap `$avg`; rounding happens after the group.

### D53. Charts follow a data-viz checklist

- **Colour by job:** status colours (green/amber/red/grey) are reserved for state (dots,
  90-day bars, failure markers). The 5-phase timing breakdown uses a categorical palette
  **validated for colour-vision deficiency** in both modes against the app's real
  surfaces (worst adjacent CVD ΔE 9.1 light / 8.4 dark, all ≥ 8), with separate dark steps.
- **Marks:** 2px lines with a ~10% area wash, ≤ 24px bars with a 2px surface gap between
  stacked segments, failure markers with a surface ring, solid hairline grid.
- **Never colour alone, never hover-only:** every chart has a Table view; uptime bars have
  a text label per level and keyboard-focusable days; the timing chart has a legend with
  averages. Refetches dim the previous chart instead of flashing a skeleton.
- Sparklines are plain SVG, not Recharts: dozens render and update every few seconds.
- The range filter (1h / 24h / 7d) sits in one row above the chart it scopes.
- Status dots are decorative (`aria-hidden`) because a visible status label is always
  next to them; otherwise screen readers would announce the status twice.

---

## Phase 7: Status pages

### D54. The public endpoint is a whitelist

- `GET /api/v1/public/status/:slug` (no login) builds its response field by field: title,
  description, overall status, and per monitor only **name, status, 90-day uptime and
  daily bars**; incidents only as **monitor name, start, end, duration**.
- Deliberately **not** exposed: monitor URLs (often internal hosts), any ids, workspace id,
  headers, and incident causes / error messages (e.g. "Connection refused to
  10.0.3.7:5432" would reveal infrastructure). A test greps the whole response for each of
  these values.
- A private page and a non-existent page both return the same 404, so slugs of private
  pages can't be discovered.
- Overall banner (`overallStatus`, pure, shared with the client): no active monitors →
  no data; none down → operational; some down → partial outage; all down → major outage.
  Paused monitors are left out (nobody is checking them).

### D55. 30-second caching, invalidated on change

- Two layers: an **in-process TTL cache** (one set of database queries per page per 30 s,
  however many visitors) and `Cache-Control: public, max-age=30` for browsers/CDNs. Even
  "not found" is cached, so random slugs can't be used to hammer the aggregation; the public
  router also has its own rate limit (120/min/IP).
- Creating, editing or deleting a page deletes its cache entries (old and new slug), so
  "make private" takes effect **immediately** (tested). Status changes of monitors are
  allowed to lag by up to 30 s; that's the accepted cost of caching and matches the spec.
  The page refetches every 30 s to match.
- Trade-off: deleting a whole workspace doesn't clear its pages' cache entries, so they can
  linger for up to 30 s. Also, each API instance would have its own cache (fine for 30 s data).

### D56. Status page management

- Slugs: lowercase letters, digits and single dashes, 3-60 chars; filled in from the title
  until the user edits it. A taken slug is a 409 shown on the slug field.
- Monitors on a page must belong to the same workspace (checked server-side); their order
  is kept. Deleting a monitor already removes it from pages (phase 3).
- PATCH re-validates the merged page (same pattern as monitors and channels).

### D57. Public pages don't touch the session

- Session restore (`/auth/refresh`) is now **lazy**: `AuthProvider` starts `idle` and only
  pages behind the login/guest guards call `ensureSession()`. A visitor of a public status
  page triggers no auth request at all (no 401 in their console, no cookie needed).
- Verified in a logged-out browser: the only API call is the public status request; no
  console errors; no horizontal scrolling at 390px width.

---

## Phase 8: Polish & ship

### D58. A seed script that tells a story

- `npm run seed` creates the demo account (`demo@pulseboard.dev / demo1234`), workspace
  "Acme Inc." with 4 monitors (the demo-target + Google, GitHub, Example.com), an alert
  channel from `.env` (Discord/Slack webhook, else an email channel → Ethereal), and the public
  status page `/status/acme`.
- History is **consistent**: 30 days of rollups plus 24 h of raw checks (every 5 min) are
  generated from the same list of past outages, so incidents, red/amber days on the bars,
  uptime %, and the dips in the response chart all agree. Today's rollup is produced by the
  real `rollupDay()` code, not faked. Random values come from a seeded generator, so every run
  looks the same.
- Re-runnable: the previous demo account and everything it owns are deleted first (reusing the
  API's `deleteWorkspace`, which also cancels jobs). Verified by running it twice.
- Lives in `apps/api/scripts` so it reuses the API's services and bcrypt; the root
  `npm run seed` forwards to it.

### D59. Route-level code splitting

- Every page except Landing and NotFound is `React.lazy`. The charting library (Recharts) is
  now only in the monitor-detail chunk, so the landing page and public status pages don't
  download it. The Vite "chunk larger than 500 kB" warning is gone.

### D60. Deployment layout

- **Render** (`render.yaml` Blueprint): API as a web service, worker as a background worker
  (no free plan exists for workers), demo-target as a free web service. Secrets are
  `sync: false` (entered in the dashboard) or `generateValue` (JWT secrets). The API reads
  Render's `PORT`; `TRUST_PROXY=true` so rate limits see real IPs.
- **Vercel** (client, root `apps/client`): rewrites `/api/*` to the Render API and everything
  else to `index.html` (SPA routing). Same-origin API calls keep the refresh cookie
  first-party (D15); Socket.io connects to Render directly with the access token.
- Vercel rewrites can't read environment variables, so the API hostname is written in
  `vercel.json` and must be edited once per deployment (documented in the README).
- **Atlas** provides the replica set that change streams need; even M0 works.

### D61. Small UX decisions from reviewing real screenshots

- Dashboard cards use a compact "34s ago" instead of "34 seconds ago" (it was truncated).
- The lowest uptime band is labelled "Outage" rather than "Major outage": on a 24 h summary
  tile, a 15-minute incident (98.97 %) read as alarmist. The public banner keeps "Major outage"
  for its own, different meaning (every service down).
- The login page offers the demo credentials (with a "Fill in" button) only when the server
  runs in `DEMO_MODE`.
- Browser tab titles follow the page ("Incidents · PulseBoard", the monitor's name, …).

---

# Upgrade: cost-aware, push-first monitoring

Goal: send fewer requests to customers' endpoints, because many customers pay per call.
Design and phase plan: [docs/upgrade/U1-contract.md](upgrade/U1-contract.md) and
[PROGRESS.md](PROGRESS.md).

## U1: Cheap checks + cost visibility

### D62. HEAD by default, GET only when needed

- New monitors default to `HEAD`: the server sends status + headers but no body, which is
  usually all an uptime check needs, and is cheaper for the customer's server and network.
- A keyword check needs the body, so the default is `keyword ? GET : HEAD`, and `HEAD` +
  keyword is rejected (it could never match). This is computed in the shared schema, so the
  form and the API agree.
- Some servers don't implement HEAD and answer `405 Method Not Allowed` or `501 Not
Implemented`. The checker then retries the same URL with GET **within the same check**
  (so the result is still correct) and the worker stores `headUnsupported: true` on the
  monitor; later checks go straight to GET instead of paying for two requests.
  Only 405/501 trigger it: other errors to HEAD (403, 404, 500) are real answers.
- **Existing monitors are untouched**: they keep the method they were created with
  (the migration never changes `method`).

### D63. Never download a body nobody reads

- Without a keyword, the response is closed as soon as the headers arrive: we already have
  the status code and the time to first byte. The trade-off: `downloadMs` is now 0 for such
  checks (download time was rarely meaningful for health endpoints anyway). With a keyword,
  the body is still read, capped at 1 MB (D34).
- This applies to existing GET monitors too. Their verdict is identical (status code
  decides), they just stop downloading pages for nothing.

### D64. Checks identify themselves

- Every check sends `User-Agent: PulseBoard/1.0 (+<APP_URL>/bot)` and `X-PulseBoard-Check: 1`.
  Customers can filter on the header to keep checks out of analytics and metered billing,
  and the public `/bot` page explains both headers.
- The marker header is applied **after** custom headers, so a custom header can't remove it.
- `APP_URL` defaults to `DASHBOARD_URL` (the same public web app), so no new required
  setting.

### D65. Counting requests: a tiny counter collection, not the time-series data

- `MonitorUsage { monitorId, workspaceId, month: "YYYY-MM", requests }`, one document per
  monitor per UTC month, bumped with an upsert `$inc` after each check. Counting the
  time-series `checkresults` would scan thousands of documents and only covers 7 days.
- The unique index `{monitorId, month}` prevents duplicate counters; when two "first of the
  month" upserts race, MongoDB (4.2+) retries the loser as an update by itself.
- What counts: **every request actually attempted** against the customer: redirect hops, a
  HEAD that fell back to GET, and "Test now" on a saved monitor. "Test now" on an unsaved
  form can't be attributed to a monitor, so it isn't counted (it's rate-limited to 5/min).
- Months are UTC calendar months, matching the daily rollups.

### D66. The cost estimator is a pure, shared function

- `estimateMonthlyRequests(monitor)` = 30-day month ÷ interval (60 s → 43,200). With adaptive
  intervals (U2) the real interval only grows from the base interval, so the base interval is
  an **upper bound**, the safe direction for a cost estimate.
- `estimateMonthlyCost` uses the customer's own `costPer1kRequests` (we can't know their
  pricing) and `currency` (default INR); no price → `null`, shown as "no price set" rather
  than "₹0".
- Browser-safe and in `shared`, so the form shows the estimate live while typing, and the
  monitor page compares it with the real counter ("estimated so far" vs "sent so far").
- Push monitors (heartbeat/agent, U3–U4) send 0 requests to the customer by design.

### D67. Schema changes go through versioned, idempotent migrations

- `npm run migrate` runs each file in `apps/api/scripts/migrations/` once, recording it in a
  `migrations` collection. Each migration is also idempotent on its own (it only sets fields
  that are missing), so running it twice, or on a half-migrated database, is safe.
- Mongoose defaults would fill missing fields when documents are _read_, but queries that
  _filter_ on new fields (e.g. `type: 'http'` in U2+) need the values stored, so we migrate.

### D68. Parallel frontend and backend tracks

- From U1 on, work is split into a **backend** track (shared, API, worker), a **frontend**
  track (client) and an **integration** step (plan, contract, docs, validation, commits),
  running in parallel.
- **No blocking by construction:** each phase starts with a written contract
  (`docs/upgrade/U<n>-contract.md`) fixing endpoints and payloads; file ownership is disjoint,
  so the tracks never edit the same file and never wait on each other. They proceed on the
  contract and report open questions, which are resolved during integration. Commits happen
  only after lint, all tests and a real browser run pass.

## U2: Budgets + adaptive intervals

### D69. Adaptive intervals: back off while healthy, speed up on trouble

- `nextInterval(monitor, lastResult)` is a pure, shared function, applied by the worker after
  the incident engine has counted the check. Rules, in priority order: slowed by budget → the slow
  interval (checked **first**, so a non-adaptive monitor over budget also stays slowed; the
  backend work caught that the contract had these two the other way round); not adaptive →
  base interval (old behaviour); any failure → fastest
  interval; still down → fastest; response time over 2× its daily average → back to at most the
  base interval; every 10th consecutive success while up → double, capped at the slowest
  interval; otherwise unchanged.
- A failure drops straight to the fastest interval so an outage is **confirmed quickly**:
  the incident rules (3 failures / 2 successes) are untouched, they just run at the fast
  pace. The trade-off: a monitor that has backed off notices an outage at its _next_
  (slower) check. That's the cost/latency trade customers opt into; it's on by default only
  for **new** monitors, and existing monitors keep fixed intervals.
- A response-time spike pulls a backed-off interval back to the base (`min(current, base)`):
  slowness is often the first sign of trouble, but it should never slow down a monitor that
  is already checking fast.
- Doubling uses the engine's own `consecutiveSuccesses` (every 10th success) instead of a
  separate counter, so there's one source of truth for streaks.

### D70. A moving average instead of a 24-hour query

- "Response time > 2× its 24 h average" would need a raw-check aggregation on every check.
  Instead each monitor keeps a time-weighted exponential moving average (time constant 24 h)
  updated in O(1) per check. It weighs recent checks more, so it's an approximation of a
  24 h mean, which is fine for spotting a 2× spike.

### D71. Applying a new interval to Agenda without fighting it

- Agenda computes `nextRunAt` when a run **starts** and writes it back from memory when the
  run ends (it doesn't write `repeatInterval` then). Updating the job document during the run
  would therefore be overwritten. The worker changes the interval on the **running job
  object** (`repeatInterval` + `nextRunAt` in memory) and also persists `repeatInterval` in
  `agendaJobs`, so both this run's save and all future runs use the new interval. Verified in
  Agenda's source before designing (see the U1 plan).
- Everything that (re)schedules (API, boot reconcile) now uses `currentIntervalSec`, otherwise
  a worker restart would silently reset every adaptive interval to the base value.

### D72. Budgets: warn at 80 %, act at 100 %, exactly once

- After each check the usage counter is bumped with `$inc` and the new count compared with
  the budget (`budgetState`, pure). Crossing 80 % and 100 % is recorded with
  **conditional updates** on the month's `MonitorUsage` document (`warnedAt: null →
now`), so even with several workers only one sends the warning and only one applies the
  action.
- Actions: `slow` (default) switches to 15 minutes (or the slowest adaptive interval if
  that's longer) for the rest of the month; `pause` pauses the monitor with
  `pausedReason: 'budget_exceeded'`, which a manual resume can't undo until the budget is
  raised (409 `BUDGET_EXCEEDED`). Raising the budget lifts the restriction immediately.
- `slow` is the default because a budget usually means "spend less", not "stop watching".

### D73. Monthly reset that can't be missed

- The restriction is stored as `budgetExceededMonth: "YYYY-MM"`, not a boolean. The reset
  job (1st of the month, 00:00 UTC) restores every monitor whose month is not the current
  one, and the same logic runs at worker boot, so a worker that was down at midnight still
  catches up. User-paused monitors are never touched (`pausedReason: 'user'`).

### D74. Notices: alerts that aren't incidents

- Budget warnings (and, in U4, "agent silent but endpoint reachable") need to reach the same
  channels as incident alerts, but have no incident. A separate `send-notice` job reuses the
  senders and the 30 s / 2 min / 8 min retry policy; "once" is guaranteed by the markers on
  `MonitorUsage` (or the monitor), not by the job.

### D75. Validation caught what unit tests couldn't: Agenda job ids are strings

- In the real run, the adaptive monitor's `currentIntervalSec` became 20 s but the worker kept
  checking every 10 s. Cause: Agenda's MongoDB backend hands jobs to handlers with `_id`
  converted to a **hex string**, so updating the stored job by `{ _id: job.attrs._id }`
  matched nothing; every later run reloaded the old interval. The unit test had built its fake
  job from the raw document (an ObjectId), so it passed.
- Fix: match the stored job robustly (converted ObjectId / name + monitor id, checking that one
  document matched), decide whether to re-apply based on the **job's actual**
  `repeatInterval` (so any drift heals itself on the next run), and a regression test with a
  job shaped exactly like Agenda's.
- Lesson for the process (D68): every phase is validated end to end against real processes,
  not only by unit and integration tests.

### D76. Known limitations of budgets

- Lowering a budget below this month's usage takes effect at the monitor's next check, not on
  save (at most one interval later).
- Switching `budgetAction` (slow ↔ pause) after the budget is already exhausted this month
  applies from next month; raising the budget lifts the current restriction immediately.
- In DEMO_MODE the default fastest adaptive interval is 10 s, so an adaptive monitor's timeout
  must be ≤ 10 s unless the fastest interval is raised (checks may run that often).

## U3: Heartbeat monitors

### D77. Heartbeats: the customer calls us, we send nothing

- For cron jobs, workers and paid endpoints, polling is the wrong tool: a daily job can't be
  "checked" every minute, and every poll of a paid endpoint costs money. A heartbeat monitor
  gives the job a secret URL (`/api/v1/ping/<token>`) to call when it runs; PulseBoard sends
  **zero** requests to the customer.
- The token is the only credential (no login), so it is long and random (24 bytes,
  base64url → 32 chars), unique, regenerable (the old URL stops working at once), rate-limited
  **per token** (60/min), and masked for viewers. It is stored readable (unlike the agent key in
  U4) because the UI must show it in copy-paste snippets; it only lets someone _send pings_.
- `/fail` lets a job report its own failure (with a message), `/start` lets the next ping
  carry the run's duration.

### D78. One failure per missed period (and why thresholds became per type)

- An overdue detector runs every 30 s, but it must not record a failure every 30 s: uptime %
  is "successful checks ÷ all checks", so a daily job would show one success against
  thousands of failures. Instead it records **exactly one failure per missed period**,
  advancing `nextDueAt` with a conditional update so two workers can't both record it. Uptime %
  then means "share of expected runs that pinged".
- With one sample per period, "3 failures in a row" would mean three missed runs: three days
  for a daily job. So incident thresholds became **per monitor type**: heartbeat 1/1 (the
  grace period is the confirmation), http and agent keep 3/2. The pure state machine takes the
  thresholds as input; the http rules and their tests are unchanged.

### D79. One incident engine, used by two processes

- Pings arrive at the **API**, overdue failures are found by the **worker**. Rather than
  duplicating the incident logic, the engine moved from the worker into `shared`; both
  processes run the same atomic counting and guarded transitions. The API can queue alert jobs
  because its Agenda instance writes jobs without processing them.
- Pings are stored in the same `CheckResult` time-series collection (with `source:
'heartbeat'`), so uptime %, rollups, 90-day bars, status pages and alerts work for heartbeat
  monitors without any changes.

### D80. Heartbeat details settled during U3

- Token: 32 random bytes, base64url (43 characters), regenerable; the old URL returns 404 at once.
- Missed periods are backfilled at most 50 per detector run, so a worker that was off for a
  long time catches up over a few 30 s runs instead of writing thousands of failures at once.
- Between the due time and the next detector run (≤ 30 s) the UI already shows "Overdue since
  …" while the status changes at the detector run: the card is exact, the status is
  confirmed.
- Validated on real processes: `/start` → ping recorded a 1.2 s run duration; stopping pings
  opened an incident 44 s later ("No ping received within 10s + 5s grace"); the next ping
  resolved it; `/fail?message=…` opened an incident with that cause; usage showed 0 requests
  sent and 6 pings received.

## U4: `pulseboard-agent` + probe-on-silence

### D81. Push-first with real traffic: the agent

- An Express middleware in the customer's app measures **real requests** (status, duration,
  route pattern) and sends one aggregated report per minute. PulseBoard learns error rate and
  latency from actual users instead of synthetic pings, and sends **no** requests while the
  agent reports.
- Privacy by construction: only route **patterns** (`/orders/:id`), never full URLs, ids or
  query strings; no headers, bodies or IPs. The README lists exactly what is sent.
- The agent must never hurt the host: recording is O(1) and synchronous, memory is bounded
  (reservoir of 5,000 samples, at most 50 routes per window), failures to report are dropped
  with one warning (no retry queue that could grow), it never throws into the app and never
  calls `process.exit`. Zero runtime dependencies.
- A report is sent **even with zero traffic**: it doubles as a heartbeat, so silence means
  the app (or its network) is down, not just quiet.

### D82. Agent keys are hashed; heartbeat tokens aren't

- The agent key authenticates writes of production metrics, so it's treated like a password:
  shown **once**, stored only as SHA-256, regenerable. Heartbeat tokens (D77) must appear in
  copy-paste snippets every time, so they're stored readable. Different exposure, different
  storage.

### D83. Probe-on-silence: pull only as a fallback

- Silence (no report for 2 × the report interval) is ambiguous: the app may be down, or only
  the agent/network path may be broken. So PulseBoard then **probes** the app's public URL (up to
  3 HEAD requests, 10 s apart, with the normal check runner and SSRF guard). Each probe is a real
  check fed to the incident engine: 3 failures meet the agent threshold (3/2) and open the
  incident about 1.5–2 minutes after the last report, a probe success marks the monitor
  `degraded` ("agent silent, endpoint reachable"), alerts once, and opens **no** incident.
- `degraded` is shown as operational on public status pages: the customer's users are fine.
- Without a probe URL, silence itself counts as one failure per detector cycle.
- Probes and optional low-frequency external checks (900–1800 s suggested, for DNS/SSL/routing
  issues the agent can't see from inside) are the only requests an agent monitor sends; they're
  counted in `MonitorUsage` like everything else.

### D84. U4 details and validation

- Agent keys look like `pbk_…`, returned once as `data.agentKey`; only the SHA-256 hash is stored.
- Robustness added during backend work: a report arriving mid-probe stops the probes; a
  `probing` state left by a crashed worker resets after 10 minutes; silence is measured from
  creation/resume (`watchSince`), so a resumed monitor isn't flagged silent at once;
  `lastProbeAt` stops two workers probing the same monitor; reports from an agent whose clock is
  more than 5 minutes off are placed on the server clock.
- Known limitations: probes count only 200–399 as reachable (point the probe URL at a health
  endpoint); a monitor that is silent **and down** recovers when its agent reports again (re-probing
  only runs while degraded).
- Dashboard summary counts `degraded` as Up (endpoint reachable), consistent with public pages.
- Validated with a scratch Express app running the real SDK against the real API and worker:
  route recorded only as `/api/orders/:id` (ids and query stripped); error-rate breach → incident
  after 84 s (3 windows of 30 s), resolved after 90 s; agent stopped but app serving → `degraded`
  after 66 s with one notice and **no** incident; process killed → 3 probes failed → incident after
  108 s ("Connection refused"); restarted → resolved after 63 s; only 4 requests ever sent (probes),
  12 reports received.

### D85. The Cost & Usage page: one aggregation, totals that match the rows

- `GET /workspaces/:wid/usage?month=YYYY-MM` reads the month's `MonitorUsage` documents in one
  aggregation and the workspace's monitors in one query. No per-monitor queries, so the page stays
  cheap however many monitors there are.
- Totals are the sum of the rows. Deleting a monitor now also deletes its usage documents (and
  deleting a workspace its usage and agent reports, which were previously left behind), so the
  totals always match the table.
- Costs are summed **per currency** and never converted: we have no exchange-rate source, and a
  converted total would look precise while being wrong. The cost sort compares raw amounts.
- Paused monitors send nothing, so the page shows them with 0 estimated requests, cost and
  requests saved. The single-monitor usage card keeps the plain estimate, because it describes
  the monitor's configuration.
- Estimates and budgets describe the **current** configuration, even when an earlier month is
  selected. We store requests per month, not past configurations, and the page says "at the
  current intervals".
- "Requests saved" for an adaptive http monitor is computed from its estimate, which is the
  upper bound at the base interval (D69). So adaptive back-off shows up in "requests sent" but
  not as savings: the figure is conservative on purpose, and only counts what is guaranteed.
- Rejected: a chart of requests over time. One number per month doesn't make a meaningful line,
  and stat tiles plus a sortable table answer "what costs what" directly.

### D86. Same guarantees for every monitor type, proven through the real entry points

`apps/api/test/crossType.test.js` drives each type through the path production uses: http through
`runHttpCheck` and the incident engine (as `run-check` does), heartbeat through the ping
endpoint, and agent through the report endpoint. It then checks the same things for all three:
result `source`, uptime %, `rollupDay`, the 90-day series, incident open/resolve, alert jobs only
for enabled channels, and a public status page that leaks no URLs, tokens, key hashes, probe URLs
or error text. Calling internal functions directly would have been easier, but it could miss
exactly the wiring that differs between types.

### D87. The demo: a real agent, real traffic, one-click scenarios

- The seed writes the git-ignored `apps/demo-target/.pulseboard-demo.json` (agent key, endpoint,
  report interval, heartbeat URL). The demo-target reads it, or the `PULSEBOARD_AGENT_KEY` /
  `PULSEBOARD_ENDPOINT` env vars, and re-reads it every 5 s, so re-seeding needs no restart.
  Re-seeding keeps an existing, well-formed key and token, so a running demo keeps working.
- The demo-target generates about 1 request per second for itself, so the agent charts move
  without a load generator (`DEMO_TRAFFIC=off` disables it).
- The **agent silent** scenario also resets the site to healthy. Probes count a 500 as down, so
  a silent agent on an erroring site would open an incident instead of showing "degraded". This
  was caught in the frontend smoke run.
- The heartbeat script isn't started by `npm run dev`: the demo starts it by hand, so "pings
  stop → incident" can be shown. `--stop-after <n>` counts runs. The seeded heartbeat history
  has no random single failures, because one missed period opens a heartbeat incident.
- Seed values go through the API's own Zod schemas, so seeded monitors get the same defaults
  (HEAD, adaptive, thresholds) as monitors created in the UI.

### D88. Warm theme: peach light, black and pale-orange dark

- **Slate is remapped, not replaced.** About 464 `slate-*` classes carry the neutral. Rather than
  edit every call site, `index.css` overrides `--color-slate-50 … 950` in `@theme` with a warm
  scale: `#fff7f0` (pale peach) through `#17110d` / `#0a0706` (warm near-black). The light body is
  `slate-50` (peach), so white cards sit on it; the dark body is `#000`. The catch is that the name
  "slate" no longer describes the colour. We accept that because a rename would touch almost every
  component for no visual gain.
- **A `brand` palette that flips by mode.** `--color-brand-50 … 950` is a green pop in light mode
  (button fill `brand-600` `#0a7d48`, white text 5.2:1) and is redefined under `:root.dark` as pale
  orange (`brand-600` `#f9a05a`, `brand-400` `#ffbd7f` for links). `--color-on-brand` flips with it
  (white on green, `#120b06` on orange, 9.5:1), so one class list (`bg-brand-600 text-on-brand`)
  works in both modes. `primaryButtonClasses` (exported from `Button.jsx`) is reused by links
  styled as buttons (Dashboard, Landing, agent wizard).
- **How emerald was split.** Emerald now means state only. It became `brand` wherever it meant
  primary, focus, active, link or selection: buttons, focus rings, inputs, switch, active nav,
  links, wizard steps, type chooser, spinner, logo and Landing CTAs. It stayed emerald wherever it
  reflects a monitor or incident: `STATUS_STYLES.up`, "Up"/"Operational" text, the green badge
  tone, uptime bars (`--color-status-up`), test results, incident "resolved", agent/heartbeat
  "reporting", and the "requests saved" note. Rule of thumb: if it would turn red when something
  breaks, it is status. Small-text "Up" moved from emerald-600 (3.8:1 on white) to emerald-700
  (5.5:1).
- **Status tokens retuned, meanings unchanged.** Light: up `#16a34a`, down `#e5484d`, pending
  `#f59e0b`, paused `#a8a29e`, none `#ead8c8`. Dark: up `#22c55e`, down `#f05252`, pending
  `#fbbf24`. The dark pending is yellower on purpose, so on black it never reads as the
  pale-orange brand.
- **Contrast.** Muted text (`slate-500` `#856d5c`) is at least as strong as the old slate in every
  place it appears: 4.84:1 on white (was 4.76), 4.57:1 on peach (was 4.55 on slate-50), 4.34:1 on
  black (was 4.24 on slate-950) and 3.87:1 on dark cards (was 3.75). `slate-400` on dark cards is
  6.26:1, and brand links in dark are 12:1.
- **Charts.** Series and timing hues are unchanged. Chart surfaces follow the cards: white in
  light mode, `#0e0a08` in dark (slate-900/60 over black). Grid and axis tokens use the new
  slate. The dataviz validator passes every check on both surfaces, including CVD separation
  (worst adjacent ΔE 9.1 light, 8.4 dark). As before, three light slots are under 3:1 against
  the surface (warning only, not a failure); charts relieve this with legends and labels.
- **Depth, here and there.** Four `@utility` classes in `index.css`: `press-3d` (primary buttons
  have a bottom edge and an inner highlight, and sink 2px on press), `surface-3d` (cards have
  layered warm shadows), `lift-3d` (monitor cards rise 2px on hover) and `tilt-3d` (the Landing
  preview is tilted back in perspective and settles flat on hover). The logo is a top-lit tile
  with a highlight edge. On a black page a shadow is invisible, so dark mode replaces shadows with a
  faint top highlight and a soft pale-orange glow. With `prefers-reduced-motion: reduce`, all
  transforms and transitions are removed and only the static depth remains. No new dependencies.

### D89. OAuth sign-in prepared: Google and GitHub, enabled by credentials

- **Enabled by credentials.** A provider is on only when both `*_CLIENT_ID` and
  `*_CLIENT_SECRET` are set; `GET /auth/oauth/providers` lists the enabled ones and the client
  shows buttons only for those. Going live is a `.env` change and a restart, no code change.
- **State and PKCE live in a cookie, not the database.** `start` writes the state, the PKCE
  verifier (S256) and the sanitised `next` into `pb_oauth`: httpOnly, SameSite=Lax, path
  `/api/v1/auth/oauth`, 10 minutes, HMAC-SHA256 signed with a key derived from
  `JWT_REFRESH_SECRET`, and cleared on the callback whatever the outcome. Abandoned sign-ins
  cost no writes and need no cleanup, and the state is bound to the browser that started it
  (login CSRF). A TTL collection would have worked too, but adds a write per click for no gain.
  Two tabs starting sign-in at once: the later one wins.
- **Linking rule: verified email only.** An already linked provider account wins; otherwise the
  account is linked to the user with the same email **only** if the provider marks it verified
  (Google `email_verified`; GitHub: the primary email, and only if verified). Unverified emails
  never link or create anything (`OAUTH_EMAIL_UNVERIFIED`), since anyone can type someone
  else's address into a provider account. A unique partial index on
  `(identities.provider, identities.providerId)` (migration 003) keeps one provider account on
  one user.
- **No provider tokens are stored.** The access token is used once to read the profile and then
  dropped. We only need identity, never to act on the user's behalf, so there is nothing to leak.
  `identities` holds provider, provider id, email and `linkedAt`.
- **OAuth-only users have no password.** `passwordHash` is optional. Password login for such a
  user is compared against the dummy hash and returns the same `INVALID_CREDENTIALS` as an
  unknown email (no enumeration). `/auth/me` exposes `providers` (names only) and
  `hasPassword`, never provider ids.
- **Same session as login.** The callback reuses the auth service's token issuance and the same
  `pb_refresh` cookie, then redirects to `/auth/callback?status=ok&next=…`; the client calls
  `/auth/refresh`. No token is ever put in a URL, and the request logger drops the callback's
  query string (it carries the one-time code).
- **Callback via the client origin.** The redirect URI is
  `${APP_URL}/api/v1/auth/oauth/:provider/callback` (`APP_URL` defaults to `DASHBOARD_URL`).
  The browser lands on the client origin, which proxies `/api` to the API (Vite in dev, Vercel
  rewrite in prod), so both cookies stay first-party and SameSite=Lax is enough.
- **`next` is a same-origin relative path** (one leading `/`, no `//`, no backslash, no scheme,
  no control characters, at most 512 chars), otherwise `/app`. It is checked at `start` and
  again when read back from the cookie.
- **Failures are redirects, not JSON**, because start and callback are browser navigations. That
  includes the rate limit (twice the login budget per IP, since one sign-in is two requests).

### D90. Orange dark brand and a yellow-to-red heat ramp for charts

- **Dark brand is a full orange** (600 = #f97316, hover 700 = #ea580c, links 400 = #fb923c)
  instead of the pale orange of D88. Near-black text on it stays at 5:1 or better. Dark primary
  buttons carry a yellow → orange → red gradient (the chart ramp); light mode keeps the green
  brand.
- **Charts use one heat ramp** (`--color-heat-low/mid/high`): yellow, orange, red, re-stepped
  per mode (deeper in light for contrast on white). Single-series lines and areas get a vertical
  gradient measured against the visible axis, so colour follows the value: slow responses and
  high error rates are red, a quiet line near zero is yellow. Lines whose own range is tiny get
  a solid colour, because an objectBoundingBox gradient on a zero-height shape is not painted.
- **Ordered series take steps of the same ramp** (p50/p95/p99, and DNS → TCP → TLS → TTFB →
  download), darkening monotonically; they also keep their dashes, legend and table view, so
  identity never depends on hue alone.
- **Status colours are untouched.** Uptime bars, status dots and badges still mean green = up,
  amber = degraded, red = down; the heat ramp is only for measurements.

## UI redesign: "Dark Editorial"

### D91. Design tokens, shadcn/ui foundations and React 19

- **Supersedes D88 and D90.** The warm peach / orange theme and the yellow-to-red chart ramp are
  replaced by the editorial direction: near-black canvas, hairlines, one yellow accent, charts in
  status or text shades.
- **One tokens file** (`apps/client/src/styles/tokens.css`): `:root` is dark, `[data-theme="light"]`
  redefines the same names. `index.css` maps tokens into Tailwind with `@theme inline` (utilities
  read the variable at runtime, so a theme switch needs no rebuild): `bg-bg`, `bg-surface(-2/-3)`,
  `border-line(-strong)`, `text-fg/muted/faint`, `bg-brand` + `text-brand-ink` (yellow),
  `status-*`, `font-heading`, `font-mono`, `rounded-sm/md/lg`, `shadow-panel`. Where a Tailwind
  theme key has the token's own name (`--radius-sm`, `--font-mono`), Tailwind emits a
  self-reference in its theme layer; the unlayered tokens file wins the cascade, verified in the
  browser (4px, JetBrains Mono).
- **Contrast fixes to the brief's values:** `--text-faint` is #7C7C86 dark (4.8:1 on --bg, was
  3.6:1) and #6E6E77 light (4.5:1, was 3.3:1), since it is used for 11px labels. Light `--accent`
  (#F2B705) is 1.8:1 against the page, so it is only ever a fill with `--accent-ink` text; the light
  focus ring is ink with a yellow halo (`--focus-ring`). Added `--status-pending` (grey, pulses).
- **Theme switch** is `data-theme` on `<html>` (was a `dark` class); `dark:` utilities follow it.
- **Texture:** film grain is a fixed `body::after` with an inline SVG `feTurbulence` data URI
  (5 % dark, 4 % light, overlay blend, no pointer events); `halftone` is a 4 px dot utility.
- **shadcn/ui** initialised with `tsx: false` (components arrive as `.jsx`, our ESLint and JS
  codebase stay as they are), components in `@/components/shadcn` because Windows' case-insensitive
  file system made shadcn's `button.jsx` overwrite our `Button.jsx` in `components/ui`. Every shadcn
  semantic colour points at a token (shadcn's `accent` = our `surface-3` hover; our yellow is
  `primary`/`brand`). `cn` is clsx + tailwind-merge.
- **React 19.3** (current shadcn/ui components pass refs as props). One copy after
  `npm dedupe`. While upgrading we found the client was being built in development mode: the root
  `.env` sets `NODE_ENV=development` for the API, and Vite turns a `.env` NODE_ENV into a dev build.
  `vite.config.js` claims `VITE_USER_NODE_ENV` first on `vite build`; the entry chunk went from
  565 kB to 358 kB.
- **Transitional bridge:** until phases 3–5 rebuild every page, the old palette classes (`slate-*`,
  `brand-*`, chart series/heat tokens) are pointed at the new neutrals, the yellow accent and text
  shades, and the old 3D utilities are flattened. The bridge is deleted at the end of phase 5.

### D92. Metrics endpoint for the Health deck

The monitor page's Health deck shows four cards per monitor type, each with a big value, a change
against the previous window and a sparkline. It reads one new endpoint,
`GET /workspaces/:wid/monitors/:mid/metrics?range=1h|24h|7d`, instead of composing `/checks`,
`/agent-metrics` and `/uptime` in the browser: that would need several requests per type, would
derive buckets differently per chart, and `/checks` returns raw points under 500 checks, so the
series would not line up between cards.

- **Fixed grids.** 1 h = 60 × 1 min, 24 h = 96 × 15 min, 7 d = 84 × 2 h. The last bucket is the one
  containing now (partial). Bucket starts are epoch-aligned, which is what `$dateTrunc` produces
  for these sizes (bins anchor at 2000-01-01T00:00Z, a whole number of days from the epoch); a test
  asserts the JS grid equals the `$dateTrunc` output for all three ranges.
- **Every bucket is present; no data is `v: null`**, which the charts draw as a gap. A bucket
  without checks is not 0 % uptime and not 0 ms.
- **Previous window** (the same length, directly before) gives `previous` and `change`. It comes
  from the same `$facet` as the current buckets, so each collection is read with one aggregation
  bounded by monitor and time (the time-series indexes apply). Raw data only lives 7 days, so the
  7 d change is mostly `null`.
- **p95 is approximate** (`$percentile`, method `approximate`): exact percentiles would need all
  values in memory. Agent p95 is the requests-weighted mean of the reports' p95, not a true p95 of
  all requests, rounded to 0.1 ms (agent latencies are often under 1 ms).
- **Heartbeat lateness** uses `$setWindowFields` with `$shift` over the pings (missed records
  excluded), with one ping before the previous window as predecessor of the first. Missed pings are
  found by the error prefix, exported as `MISSED_PING_PREFIX` in the shared constants and used by
  both the overdue job's message and the aggregation.
- **Live accumulators** (`live.last`, `live.range`: n, ok, sumMs, nMs) let the client fold incoming
  `check:result` events into uptime, failed %, average response and duration without refetching;
  p95 and agent metrics resync on the next poll.
- No existing route, schema or index changed. Pure helpers (grid, rounding, change, series summary,
  assembly) are exported from `metrics.service.js` and unit-tested.

### D93. Health deck

- **Own component, no library.** The deck is built from Recharts, Tailwind and the design tokens
  only (`components/health/`: `HealthDeck`, `MetricCard`, `DetailPanel`, `HealthSparkline`,
  `HealthAreaChart`, `TimingChart`). Pure logic lives in `lib/health.js` (value and change
  formatting, selection fallback, key maths) and `lib/metricsFold.js`; `lib/metricsFixture.js` is a
  seeded fixture generator used by the tests.
- **Cards and selection.** Cards render whatever `metrics` the API returns, in order. Exactly one is
  always selected; the first by default. The selection is stored as a key and resolved on every
  render (`resolveSelection`): it survives a range or type change while the key exists, else the
  first card wins. Ranges are 1h / 24h (default) / 7d. `p95` and `avgResponse` get a second detail tab,
  "Timing breakdown", only when `timings` is non-null (http).
- **Query.** `useMetrics` keys `['workspaces', wid, 'monitors', mid, 'metrics', range]`, outside
  `analyticsKey`, so check events do not invalidate it. `keepPreviousData`; refetch every 60 s, or
  the shared fallback poll when the socket is down, whichever is shorter.
- **Live fold and throttle.** `check:result` events are buffered per monitor in
  `realtime/metricsLive.js` and flushed at most once a second with `setQueryData` on every cached
  range of that monitor. `foldCheck` ignores events not newer than `live.lastAt`, shifts the grid
  when the check is past the last bucket (the oldest bucket drops, `live.last` resets), updates the
  accumulators and recomputes uptime, failed, avgResponse (http) and duration (heartbeat). The
  range accumulator is only reset when the shift passes the whole window, so it can drift slightly
  until the next refetch resyncs it. Agent metrics, p95, missed and lateness wait for the refetch.
  No refetch is triggered and the existing invalidation is untouched.
- **Keyboard model.** The cards are a radiogroup of `role="radio"` items with a roving tabindex.
  Arrows (all four, wrapping), Home and End move focus and selection together; Space and Enter
  select. The range control and the detail tabs share the same handler. Sparklines and charts are
  `aria-hidden`; the value is text; the panel is labelled by the selected card. Charts never
  animate and the Recharts accessibility layer is off, so it cannot add tab stops.
- **Arrow and colour rule.** The arrow shows direction only (up/down of the % change); a null change
  is a dash. Colour is the exception: the down status colour is used only when the direction is
  clearly bad (failed checks, missed pings or error rate rising; uptime falling). Nothing is ever
  green; a good move is quiet.
- **States.** Skeleton cards and panel while loading; "Collecting data…" when `empty`; error with a
  Retry button. All three keep the card grid and the panel's height, so nothing jumps.
- **Left alone.** The existing charts and sections on the monitor page are untouched; the deck sits
  above them and integration decides what to retire. Isolated buckets between gaps are drawn as dots.

## UI v2: "Ambient Signal"

### D94. Dark only, new tokens and an ambient light system

> Update: a light theme was added later (D102).

- **Supersedes the theme parts of D88, D90 and D91** (peach/orange, heat ramp, yellow editorial
  tokens, film grain, halftone, status orb, light mode). Kept from D91: React 19, the shadcn/ui
  foundations (`tsx: false`, `@/components/shadcn`, `cn`) and the `@/` alias.
- **Dark only; the light-mode toggle is removed.** The look depends on moss light on near-black;
  a second theme would be a different design, not a recolour, and every glow, hairline and gauge tick
  would need its own light variant to stay legible. One theme means one set of contrast numbers to
  maintain. `ThemeProvider`, `ThemeContext`, `ThemeToggle` and the saved preference are deleted;
  `<html>` declares `color-scheme: dark` and a dark `theme-color`.
- **Tokens** (`src/styles/tokens.css`) follow the brief: `--bg`, `--surface(-2)`, `--line(-strong)`,
  `--text(-muted/-faint)`, `--accent` (pale lime), `--glow(-2)` (moss), status colours, `--radius-card`
  (16 px) / `--radius-pill`, Manrope + JetBrains Mono, and motion tokens (`--ease`, 200 ms hover,
  500 ms enter, 60 ms stagger, 800 ms gauge). **One deviation:** `--text-faint` is #7C7B71 (4.7:1 on
  `--bg`) instead of #6F6E64 (3.9:1), because it is used for 11 px micro text; `--text-muted` is 7.6:1.
  `--status-paused` keeps #6F6E64 but is only ever a dot or bar colour, never text.
- **Utilities keep their names** (`bg-surface`, `border-line`, `text-muted`, `text-faint`, `text-fg`,
  `bg-brand`, `status-*`, `rounded-card`, `rounded-pill`), so the Health deck and other
  token-based code needed no rewrite.
- **Ambient light:** `AmbientGlow` is mounted once and sits behind everything (fixed, `-z-10`, so page
  roots must not paint an opaque background; the two that did were fixed): two blurred (80 px) radial
  moss glows that drift on 44 s and 52 s loops, off-centre. A third, in `--status-down`, fades in over
  4 s at 20 % opacity while a page reports a down monitor (`useAmbientAlertSignal`, a tiny
  module-level store; it resets on unmount). Motion is off under `prefers-reduced-motion`.
- **Focus** is a 1.5 px `--accent` outline with a 2 px offset everywhere.
- **Transitional bridge.** Until the pages are rebuilt (phase 6), the old palette classes (`slate-*`,
  `brand-*`, chart series/heat/timing tokens) are pointed at the new neutrals, the cream accent and
  text shades, and `dark:` is an always-true variant so the existing `dark:` classes keep applying.
  The bridge and the variant are deleted with the last page.

### D95. Shell and primitives

- **No sidebar.** `AppLayout` renders `HeaderLine` (wordmark, workspace switcher, a 1 px hairline, live
  status, user menu with log out) and `TextNav` (13 px text links, active `text-fg`, others
  `text-faint`). Below `md` the nav is a hairline bottom bar with short labels (Pages, Alerts, Usage) so
  all seven fit at 390 px. Route, `NotFound` and permission handling are unchanged.
- **Live status** comes from existing state only: `useRealtime().connected` and `useIncidents(wid,
{ status: 'open', limit: 1 })` (its `pagination.total`). The wording lives in `lib/liveStatus.js`
  (unit tested): "All systems normal" (pulsing `status-up` dot), "N incidents open", "Offline".
- **Primitives keep their props.** `Button` variants/sizes are the same names (primary = cream pill,
  secondary = hairline, danger = `status-down` hairline, ghost); `primaryButtonClasses`, `inputClasses`,
  `Badge` tones (green/red/amber/blue/neutral) and `EmptyState`'s `icon` prop still work (the icon is
  ignored; the ring-dot is the icon). New: `RingDotCta`, `Pill`/`PillGroup`, select and textarea
  variants of `Field`. `Modal` keeps the native `<dialog>`; only the surface changed.
- **Charts.** One theme in `chartTheme.js` (no axis lines, `--line` horizontal grid, 11 px mono
  `text-faint` ticks, blurred outline tooltips, 1.5 px `--text` lines, `AreaGradient` 10% to
  transparent). The heat ramp files are deleted; `svgId` moved to `chartTheme.js` (the Health deck
  imports it from there). Timing phases are five `color-mix` tones from `--text` to `--text-faint`;
  uptime bars use `status-*` with `--line` for no data. `STATUS_STYLES` text classes now use
  `text-status-*`.
- **Bridge.** The heat and timing bridge tokens are removed. `--color-series-*` stays because the agent
  analytics page still uses it.

### D96. `RUN_MODE=combined`: one process, one free web service

- **Why.** Render has no free plan for background workers, so the original blueprint (API + worker +
  demo-target) could not run for free. The worker is only a set of Agenda handlers plus a few
  recurring jobs, so it can live in the API process.
- **How.** The worker's startup moved out of `apps/worker/src/index.js` into `startWorker({ env, logger,
agendaName })` (`apps/worker/src/worker.js`, exported as `@pulseboard/worker/start`). The standalone
  worker calls it, then adds its health server and signal handling, exactly as before. The API calls it
  from `startCombinedWorker` (`apps/api/src/combined.js`) when `RUN_MODE=combined`; in the default `api`
  mode the worker code is never imported.
- **Order.** Started after `server.listen`, so the port is bound for the platform's health check while
  the worker catches up (monthly budget reset, job reconciliation). A start failure is fatal, like a
  standalone worker. On shutdown the worker stops first, releasing the jobs it holds.
- **Two Agenda instances.** The API keeps its unstarted instance (it only writes jobs); the worker
  creates its own started one. They share the database exactly as two processes would, so scheduling
  behaves the same (D71, D75) and a standalone worker can still run beside a combined API: Agenda's
  locking prevents double runs and the recurring jobs are upserted, one per name (tested with two
  runners).
- **Not started in combined mode:** the worker's own `/health` server (one port per web service).
  The API's `/health` gains `worker: "off" | "running" | "stopped"`; a stopped combined worker makes it
  `degraded`.
- **Concurrency.** `AGENDA_MAX_CONCURRENCY` (default 20) now also applies to the API; the blueprint sets
  5 because the free plan has 512 MB of memory.
- **Trade-offs, stated plainly.** One crash takes checks and API down together, and the worker cannot
  scale separately; a free web service **sleeps after about 15 minutes without HTTP traffic and no
  checks run while it sleeps**. Mitigation: ping `/health` every 10 minutes from an external scheduler,
  or use the `starter` plan. Splitting back out is a config change (`RUN_MODE=api` plus a worker).
- **Blueprint.** `render.yaml` is a single `plan: free` web service with `RUN_MODE=combined`. The
  worker service is removed, and so is the demo-target service: a blueprint with "a single free web
  service" has no room for it, and the seed's `localhost:4011` demo monitor is refused by a deployed API
  anyway (README says how to drop or re-point it).

### D97. Pages on the new system, and the bridge removed

- **Every page and component now uses tokens only.** The transitional bridge (slate and brand palette
  aliases, chart series/heat/timing tokens, the always-true `dark:` variant) is deleted from
  `index.css`; a sweep of `apps/client/src` finds no `slate-*`, `brand-NNN`, `emerald-*`, `red-*`,
  `amber-*`, `sky-*`, `white`/`black`, `on-brand` or `dark:`.
- **Dashboard** ("All quiet." / "N monitors need attention."): a 99.9 %-target `TickGauge` from the
  share of passed checks in the sparkline data the page already loads (falls back to the share of
  monitors up), `SteppedCards` for up / down / open incidents, a `SignalField` banner fed by
  `useSignalFeed`, and whole-row monitor links. While anything is down the page raises the ambient
  alert (`useAmbientAlertSignal`), which warms the background glow.
- **Monitor detail** keeps every section; a shared hero (name headline, URL as the side phrase, status
  and SSL badges, 30-day uptime gauge) and hairline-pill actions with "Test now" as the ring-dot
  primary. The Health deck was restyled only: behaviour, the fold and the keyboard model are unchanged.
- **Cost & usage:** requests sent / saved / estimated as stepped cards, per-currency costs never summed,
  and one budget gauge per monitor with a budget whose ring turns red above 80 % (`BUDGET_GAUGE_TARGET`).
- **Public pages:** the status page's wave is driven by status only, because the public endpoint
  deliberately exposes no latency (D-no-leak); the landing page runs a synthetic demo signal.
- **Deviations from "visual only", all behaviour-neutral:** page titles end in a full stop; the incident
  filter and the monitor range filter are `aria-pressed` pill groups instead of tab/radio roles; the
  "Avg response" summary card became corner text on the dashboard's signal banner.
- **Open items:** deletes in alert channels and status pages still use `window.confirm` (a `Modal`
  confirm is a follow-up), and the live-API visual pass is outstanding (the pages were checked with a
  mocked API).

### D98. Email alerts over HTTPS (Resend) and short SMTP timeouts

- **The problem, found on the live site.** "Send test alert" on the deployed email channel failed with
  `Could not deliver: Connection timeout` after 120 s. Render's free plan drops outbound SMTP
  connections (ports 25, 465 and 587) without answering, and nodemailer waited its default two minutes
  before giving up. Webhook alerts (Discord, Slack) are HTTPS and were never affected.
- **Fix 1: fail fast.** Every SMTP transport now has `connectionTimeout` 10 s, `greetingTimeout` 10 s
  and `socketTimeout` 20 s, so a blocked or silent server fails in seconds, is retried by the normal
  30 s / 2 min / 8 min schedule and does not hold one of the five alert job slots for two minutes.
- **Fix 2: an HTTPS path.** With `RESEND_API_KEY` set, email goes through Resend's HTTP API
  (`POST https://api.resend.com/emails`, 15 s timeout) with plain `fetch`: no new dependency. Order of
  preference: Resend, then SMTP (`SMTP_HOST`), then the Ethereal test inbox for local development.
  Resend's refusal reasons (for example "you can only send testing emails to your own address") are
  surfaced in the incident timeline and the test-alert error.
- **Sender address.** Resend accepts only a verified domain or `onboarding@resend.dev`. The default
  `ALERT_FROM_EMAIL` (`alerts@pulseboard.local`) is swapped for `PulseBoard <onboarding@resend.dev>`
  automatically; a real address on a verified domain is used as given.
- **Limit worth knowing.** Without a verified domain Resend delivers only to the account owner's own
  email, which is enough for a personal or demo deployment. A paid Render plan, or an SMTP provider on
  a port Render does not block (for example 2525), are alternatives that need no code change.
- **Tests.** Resend request shape and headers, the sender swap, error bodies (JSON and not), timeout
  and network errors, precedence over SMTP, and the new SMTP timeouts.

### D99. The seed only creates local-only demo monitors for a local database

- **Why.** Seeding a hosted database (the live demo) created three monitors that cannot work there: the
  demo target (`localhost:4011`, refused as a private target), the heartbeat (waits for the local cron
  script) and the agent (waits for the local demo app). On the live site they were down at once and
  opened three incidents, so the dashboard read "3 monitors need attention" from the first visit.
- **Rule.** `npm run seed` creates them when the database is local (`localhost` / `127.0.0.1`), when
  `SEED_DEMO_TARGET_URL` points at a public demo target, or when `SEED_LOCAL_DEMO=true`; it skips them
  otherwise or with `SEED_LOCAL_DEMO=false`. The skipped monitors' demo file (agent key, heartbeat URL)
  is not written either, and the output says what was skipped and how to include them.
- **How, without renumbering.** The generators and the outage list refer to monitors by position in one
  list, so the list is kept intact and a `SEEDED` list of positions chooses what is created.
- **Tested** against a throwaway replica set: original seed (6 monitors), `SEED_LOCAL_DEMO=false`
  (Example.com, GitHub, Google; status page of 3; no demo file) and the default local run (6 + file).

### D100. Alert links, one layout per error page, and the dark alert email

- **Test alerts no longer link to a monitor that does not exist.** "Send test alert" used a placeholder
  monitor, so "Open dashboard" went to `/app/<workspace>/monitors/test` (a 404). A test now links to the
  workspace's **Alert channels** page (`/app/<workspace>/alerts`) and its button says "Open alert
  channels". Real alerts and notices still link to the real monitor page.
- **One place builds every alert link** (`packages/shared/src/alerts/links.js`: `appBaseUrl`,
  `workspaceLink`, `monitorLink`, `alertChannelsLink`), from the client's public URL, trimmed of
  trailing slashes and whitespace. The variable is `DASHBOARD_URL` (the brief called it `CLIENT_URL`; the
  project has never had a variable by that name, and adding an alias would give two sources of truth).
  `DASHBOARD_URL` defaults to `http://localhost:5173`, so forgetting it on the host would send everyone to
  their own machine: the API and worker now **log a warning at startup** when `NODE_ENV=production` and it
  points at localhost, 127.0.0.1 or [::1] (or is not a URL). Locally it is correct in `.env.example`;
  in production it is set in the host's environment (Render) to the Vercel URL.
- **Every error screen gets exactly one layout** (`lib/errorLayout.js`, `components/ErrorPage.jsx`):
  inside the app shell, only the message (a missing monitor); logged in, the app shell around it (header
  line, nav, the workspace from the URL); logged out, the public header; while the session is still being
  restored, a spinner rather than a flash of the wrong header. Before, `NotFound` always drew the public
  header, so a missing monitor stacked it under the app header, and a mistyped URL showed a logged-in user
  the logged-out header. 404, workspace-not-found, monitor-not-found and the missing status page all use it.
  An error page restores the session itself (public routes deliberately never do, D57).
- **A crash screen.** `AppErrorBoundary` catches a render error and shows a 500 page with only the
  wordmark and a reload link, deliberately not the shell or the session, since either may be what failed;
  it resets when the route changes.
- **Alert email restyled to the dark theme.** `#0A0A09` page, `#ECEAD6` text, `#E3E8A8` button, Manrope
  with a system fallback (web fonts load only in clients that allow them), and a status strip across the
  card: red down, green recovered, amber notice, neutral test. Nested tables, inline styles and `bgcolor`
  attributes only, solid hex (no `rgba()`, flexbox or `<style>`), because Gmail and Outlook ignore the rest;
  a hidden preheader, a visible fallback URL under the button, and a plain-text alternative. The Discord and
  Slack messages are unchanged apart from the corrected test link.
- **Tests:** the link builders and the test-alert link (unit and through the API), the startup warning,
  the email template's structure, colours, escaping and text version, and the layout rule.

### D101. Uptime from confirmed downtime, a checker-offline state, recorded errors and sample data

- **Uptime is `100 × (1 − incident downtime ÷ time watched)`.** Before, the percentage was the share of
  passed checks while "downtime" already came from incidents, so a single failed check lowered uptime
  without any outage. Now failed checks that never opened an incident change nothing in uptime; they show
  only in "Failed checks". Every surface uses the same maths (`uptimeFromDowntime`, `combineRollups`,
  `fillDailySeries`, `windowUptime` in `packages/shared/src/uptime`): the monitor page, the 90-day bars, the
  Health deck, the dashboard gauge (a new `GET /monitors/uptime-summary`) and the public status page.
- **"Time watched" starts at the monitor's first stored result** (the earliest daily rollup if no raw result
  is left), never at its creation time: a monitor that has produced nothing has `null` ("no data"), not 100 %.
  Daily rollups store `coveredSec` (first result of the day to the end of the day, or now); rollups from before
  that existed get a full day when final (migration 005). The consequence worth knowing: raw results live
  7 days, so the 24 h and 7 d windows come from incidents over the watched time and the 30 d and 90 d windows
  from rollups.
- **A checker that is itself offline must not look like an outage.** When a check fails with ETIMEDOUT,
  ENOTFOUND, ECONNRESET or EAI_AGAIN, the worker first sends a HEAD to two reference hosts
  (`https://1.1.1.1`, `https://www.cloudflare.com`). If both fail, the result is stored with
  `state: 'unknown'`, `unknownReason: 'checker_offline'`: it is never fed to the incident engine, the adaptive
  interval or the budget, and it counts nowhere (uptime, failed checks, rollups, metrics). If one host
  answers, the failure is real. The request to the customer still counts as usage (it was sent); the probes
  do not. Charts draw unknown results as "Checker offline" gaps. Agent external checks and probes treat
  `unknown` as inconclusive (no incident, retried next cycle). Other errors (HTTP status, keyword, refused
  connection) are never probed: the checker's network demonstrably worked to get them.
- **Every failure carries a code and a message.** `CheckResult.errorCode` (`ETIMEDOUT`, `ENOTFOUND`,
  `HTTP_503`, `KEYWORD_MISSING`, `TOO_MANY_REDIRECTS`, `BLOCKED_TARGET`, `HEARTBEAT_MISSED`...) next to `error`;
  an incident keeps `causeCode` and the `code` on its opened timeline entry. The incident timeline and the
  Health deck's failed-checks panel (newest 20 from the metrics endpoint) show them.
- **Gaps are drawn as gaps.** A series is split into contiguous runs at null values; each run is its own
  line, the area fill exists only under runs of 2+ points, a lone point is a dot, and nothing is drawn
  across a gap (a single Area with nulls and a monotone curve produced the odd blocks).
- **Sample data is labelled and removable.** Fake history exists only for fictional demo monitors that point
  at the demo-target ("Demo API", "Demo Checkout", "Demo Cron Job", "Demo Agent"); Google, GitHub and
  Example.com are created empty. Everything the seed makes for the fictional monitors has `isSeed: true`
  (monitors, incidents, rollups, checks, usage, agent reports) and the UI shows a "Sample data" badge on
  seeded incidents and on charts, gauges and the public page that include it. `npm run seed:clear` deletes
  every `isSeed` document and everything owned by a seeded monitor, never real monitors or their data.
  Migration 004 gives older databases the same treatment: history cannot predate its monitor, so incidents
  and rollups from before a monitor existed are flagged and raw checks from before it are deleted.
- **Not live-folded.** The Health deck's `uptime` card is no longer updated from live check events (a pass
  rate would contradict the incident-based figure); it refreshes on the next fetch. Failed checks, average
  response and job duration still fold.
- **A test bug found on the way.** A "flaky" model test asserted that the JSON contained no `42`; the JSON
  holds a random ObjectId and timestamps, so `42` appeared by chance in many runs. It now uses a distinctive
  provider id.

### D102. A light theme, beside the dark one

- **Supersedes the "dark only" part of D94.** The design is still dark by default in spirit, but a visitor can now
  switch to a warm paper light theme with the sun/moon button (app header, public and auth headers, error pages).
- **Tokens only.** `tokens.css` keeps the dark values on `:root` and overrides the colour tokens under
  `:root[data-theme='light']`: peach-tinted paper `#fbf3e8`, ink `#1c1814`, a vivid green accent `#17803d` with paper-coloured text
  on it, status colours darkened to read as text on paper, and stronger peach and green glows. A `--series` token (ink in
  dark, green in light) colours gauge ticks and chart lines, so light mode is not just black on white. No component carries a theme-specific class. A test
  (`tokens.test.js`) checks that light overrides every colour token and that text, accent and status colours reach
  4.5:1 on the page in both themes.
- **Which theme shows.** A stored choice (`localStorage`, key `pulseboard-theme`) wins; with none, the operating
  system's `prefers-color-scheme` decides, and the page follows it live until the visitor chooses. An inline script in
  `index.html` sets `data-theme` before first paint, so there is no flash; `lib/theme.js` holds the same logic.
  The browser chrome colour (`theme-color`) and `color-scheme` follow the theme.
- **The signal field.** Its dots add light on black, which is invisible on paper. A `--field-blend` token (`add` in
  dark, `normal` in light) switches the WebGL blend function (`ONE, ONE` to `ONE, ONE_MINUS_SRC_ALPHA`) and the 2D
  fallback's composite operation, so light mode draws dark dots over the paper. A theme change calls `setColors` on
  the running renderer; it is not rebuilt, because a WebGL context cannot be recreated on the same canvas.
- **Toasts** follow the theme (sonner's `theme` prop). The alert email stays dark (D100): email clients do not run our
  CSS, so it cannot follow the visitor's choice.

### D103. One uptime formula, cut not rounded, with paused and offline time left out

- **The bug.** The monitor page showed a 30-day gauge of `100.0` next to a 24-hour card of `99.95` with a dip.
  The causes: the gauge came from daily rollups (refreshed every 15 minutes, rounded to one decimal, so
  99.96 printed as 100.0) while the card came from incidents over a bucket-aligned window, and the rollup
  and card ranges were different windows anyway.
- **One function.** `computeUptimeFromParts` in `packages/shared/src/uptime` is
  `1 − confirmed incident downtime ÷ watched time` over a window, where watched time runs from the later of the
  window start and when we began watching to the earlier of the window end and now, minus **exclusions**: paused
  time and time the checker itself was offline. `computeUptime(monitorId, from, to)` loads what it needs
  (`uptime/compute.js`). The tiles, the Health deck card and sparkline, the dashboard and public gauges, the
  90-day bars, the status pages, the rollups and the metrics endpoint all go through it. The check-count
  `uptimePercent` was deleted.
- **Pause history.** `Monitor.pauses` (`{ from, to }`, newest last, capped at 200) is written by `openPause` and
  `closePause` on every pause and resume, including the automatic budget pause. A monitor already paused before
  this existed counts as paused since its last result.
- **Offline time.** Each `unknown` result stands for one check interval and is excluded. Raw results live 7 days,
  so older offline time is known only through the rollups, whose `coveredSec` already leaves it out.
- **Watching starts** at the earlier of the first result the checker could judge and the start of coverage of the
  oldest past rollup, so a 30-day window is not cut to the 7 days of raw results.
- **Rollups use it too.** `rollupDay` writes `downtimeSec` and `coveredSec` from the formula; sample (seed) rows keep
  their numbers. 30 d and 90 d are the final rollups of past days plus today computed live.
- **Cut, never rounded.** `uptimeFromDowntime` truncates to 3 decimals and is exactly 100 only when downtime is 0; the
  shared `formatUptime` prints 2 truncated decimals or `100`. The gauges use the same text (`uptimeGaugeProps`).
- **Ranges are labelled.** The monitor-page gauge stays at 30 days and says so; the Uptime card follows the selected
  range and its label reads "Uptime · last 24h". Its figure covers exactly that range ending now (not the
  bucket-aligned grid), so it equals the 24 h and 7 d tiles. A sparkline bucket is the same formula over the bucket,
  so single failed checks never dip it, and a bucket with nothing watched is a gap.
- **Change label.** For uptime, the change is percentage points between the displayed figures (`-0.70%`); no change
  reads `±0.00%` instead of `0%`.
- **`npm run rollups:rebuild`** recomputes every stored day with the formula (days without raw results keep their
  counts and get their downtime and watched time recomputed from incidents and pause history). Run it once after
  upgrading.

### D104. Resend is the email provider

- **Chosen:** alert and invitation email go through Resend (`RESEND_API_KEY`, sender `ALERT_FROM_EMAIL`). The docs, UI
  hints, `.env.example`, `render.yaml` and the tech stack table all say "Email (Resend), Discord, Slack".
- **Why:** the free tier is enough for a small deployment, and sending is a single HTTPS call. That matters on Render's
  free plan, which blocks outbound SMTP ports, so an SMTP provider could not work there at all.
- **SMTP stays** as an optional fallback (`SMTP_*`, nodemailer) and as the local-development inbox (Ethereal), so nothing
  needs a real account to try the app. It is commented out in `.env.example` and is one row in the README table.
- **Caveat:** Resend only sends from a verified domain. Until one is verified, mail can only go to the account owner's own
  address, so set `ALERT_FROM_EMAIL` to an address on the verified domain.
- No other email provider was ever wired into the code; there was nothing to migrate.

### D105. A read-only public demo

- **Problem:** the demo login (`demo@pulseboard.dev`) is public, so anyone could delete monitors, change channels or
  fill the database.
- **Viewer, not a special case.** With `DEMO_READ_ONLY=true` the demo user is a **Viewer** of the demo workspace, using
  the existing role checks, so every mutating route already answers 403 and reads still work. The workspace is owned by a
  separate owner account with no password, so nobody can log in as it (an existing account named by `DEMO_OWNER_EMAIL`,
  otherwise a default one created on demand). The owner is only created or promoted where the demo user was the sole owner;
  an existing co-owner is kept, so a workspace is never left without an owner.
- **`POST /workspaces` is refused** for the demo user, because a Viewer could otherwise create a workspace of their own
  and be its owner.
- **Visible to the visitor:** `GET /meta` returns `demoReadOnly` and `demoEmail` (the email only when read-only). The client
  shows a "Demo mode — read-only" banner when the signed-in user's email equals `demoEmail`.
- **Daily reset.** A worker job `demo-reset` runs at 03:00 UTC. It re-applies the Viewer role and rebuilds the sample
  "Demo Checkout API" monitor and its incidents, keeping its status-page entry. The role is also applied once when the
  worker boots, so turning the flag on takes effect after the next deploy. The locally seeded fictional monitors are not
  rebuilt by the daily job.
- **Default off.** `DEMO_READ_ONLY` defaults to `false` so local development stays editable; `render.yaml` sets it to `true`.
- **Unaffected:** the demo-target `/admin` controls are a separate server with no API auth, so they keep working
  whatever the demo user's permissions are.
- `npm run seed` applies the same role after creating the demo workspace, and when read-only it also removes workspaces where
  the demo user is a Viewer, so re-seeding does not leave duplicates.
- The demo module lives in `packages/shared/src/demo` so the seed script and the worker share one implementation.
- **Known limit.** Turning `DEMO_READ_ONLY` back to `false` and re-seeding does not delete the old Viewer workspace (only
  workspaces the demo user owns are removed when the flag is off), so it is left behind as an orphan.

### D106. Import from GitHub

- **Problem:** adding monitors for every deployed project by hand is slow, and people forget some. The user's public
  repositories already say where their sites live.
- **GitHub API, not scraping.** Candidates come from the REST API: the repo's `homepage`, the GitHub Pages URL, the
  latest deployment status `environment_url` per environment, and README links (hosting domains or links labelled
  "demo", "live" or "website"). This is deterministic, needs no HTML parsing of github.com, is allowed by GitHub's terms
  and has a documented rate limit. No AI is involved: extraction, ranking (deployment > homepage > pages > readme),
  dedupe and classification are pure functions in `packages/shared/src/github`, unit-tested on their own.
- **Probing** uses the normal check runner (HEAD, 5 s, SSRF guard, falling back to GET when a server rejects HEAD).
  `runHttpCheck` now also returns `finalUrl` (the URL after redirects) so a candidate that ends on another site is shown
  as `redirect`, not `live`. `GITHUB_*` failures use the existing error shape.
- **Minimal scopes.** Login still asks only for `read:user` and `user:email`. Public repos need no scope at all, and
  `repo` would expose private code, so it is never requested. Private repositories are out of scope. The token is sent
  with the request only for the higher rate limit (5,000/h instead of 60/h per IP).
- **How the token is stored.** To call GitHub later (not only at sign-in) the access token must be kept. It is
  encrypted with AES-256-GCM (`node:crypto`, random 96-bit IV, auth tag, format `v1.<iv>.<tag>.<data>`) on the GitHub
  identity (`tokenEnc`, plus `tokenScope`, `tokenUpdatedAt` and `login`), and overwritten at every GitHub sign-in. The key
  is derived with HKDF-SHA256 from the optional `GITHUB_TOKEN_ENCRYPTION_KEY` (32+ characters), else from
  `JWT_REFRESH_SECRET`, so existing deployments work without new config; use a dedicated key to be able to rotate the
  JWT secret independently. `identities` is already stripped from every user JSON, and the token is never logged or put
  in an error. If the key changes or the token is revoked, the user gets `409 GITHUB_NOT_LINKED` ("sign in with GitHub
  again"); users who signed in before this feature have no stored token and get the same answer.
- **Caching: 10 minutes, per user and forks flag, in this process** (`createTtlCache`, 200 entries). A scan costs
  roughly 3 to 4 GitHub requests per repo plus the probes, so repeated opens of the dialog must not repeat it. The cache
  holds the scan only; "already monitored" is computed per request, per workspace. Concurrent identical requests share
  one scan. Limits of an in-process cache: each API instance has its own, it is lost on restart, and a deployment with
  several instances may scan once per instance. A partial scan (rate limit reached) is not cached.
- **Rate limits.** `X-RateLimit-Remaining` and `X-RateLimit-Reset` are read from every answer. The client stops sending
  at 2 requests left. If that happens while listing repos the answer is `429 GITHUB_RATE_LIMITED` with `resetAt`; during
  enrichment the scan stops politely and returns what it has with `partial: true`.
- **Limits:** the 60 most recently pushed repos (100 per GitHub page, 3 pages read before filtering), 4 candidates per
  repo, 120 probes per scan, 50 URLs per import, README read up to 200,000 characters. Not looked at: private repos,
  organisation repos the user does not own (`type=owner`), non-README docs, deployments by tools that do not report
  `environment_url`.
- **Import** reuses the monitor service (create schema, SSRF guard, scheduler): monitors are HTTP, HEAD, every 300 s,
  adaptive on, named after the repo (the name comes from the cached scan; otherwise the hostname). Member role or above.
  It also requires a GitHub-linked user so the feature behaves the same on both endpoints. The optional status page
  either creates a public page (random slug suffix) or appends to an existing one, checked before anything is created.

### D107. Brevo as the preferred email provider, beside Resend

- **Problem:** with Resend and no verified domain, mail goes only to the Resend account's own address
  (`You can only send testing emails to your own email address`), so an alert channel added by anyone else
  never received anything. The code already sent to the address in the channel; the limit was the provider's.
- **Decision:** add Brevo's transactional API (`POST https://api.brevo.com/v3/smtp/email`, `api-key` header)
  as a second HTTPS sender. Brevo delivers to any recipient from a sender address verified in the account
  (one click on an email, no domain or DNS), and has a free tier (300 a day). It works on Render's free plan,
  which blocks SMTP, like Resend.
- **Order:** `BREVO_API_KEY`, then `RESEND_API_KEY`, then SMTP, then the Ethereal test inbox for local
  development. `ALERT_FROM_EMAIL` must be the verified Brevo sender; the placeholder default is refused with a message
  saying so, instead of a vague provider error. Both HTTPS providers share one request helper, so timeouts and
  error messages (the provider's own explanation when it gives one) behave the same.
- **Resend stays** for people who own a domain; nothing is removed. The channel's "Test" button shows the
  provider's refusal if the setup is wrong.
- **Limit:** Brevo's free tier caps at 300 emails a day across all workspaces on the deployment.

### D108. An admin panel, with the administrator defined by the environment

- **Need:** see every user (the demo account too) and stop or start a user's monitors with one button.
- **Who is the admin:** the account whose email equals `ADMIN_EMAIL`. The API creates it at start-up with `ADMIN_PASSWORD`
  and re-syncs the password when the variable changes, so the secret lives only in the environment. Both must be set
  (password of 12+ characters) or there is no admin; a short password logs a warning and disables only the panel, so a
  typo cannot stop the API from starting. Creating the account at boot also means nobody can register the admin address
  first. **The credentials are deliberately not in the README**: the repository is public, so a password there would let
  anyone stop everyone's monitors. The README documents the variables and the steps instead.
  **Amended for the evaluation:** the project is graded by someone who has to be able to sign in as the admin, so the
  README now publishes a dedicated, throwaway account (`admin@pulseboard.dev`, not a personal address, with a password used nowhere
  else), marked temporary, with the steps to remove it (delete the two variables) or lock it (change the password) afterwards.
  `.env.example` carries the same values so a local run has an admin out of the box. The risk accepted: until it is removed,
  anyone who reads the README can sign in to a deployment that has these values and stop that deployment's monitors.
- **No new role in the database.** Admin is decided on the server by comparing the signed-in user's email with `ADMIN_EMAIL`
  on every admin request (and reported to the client by `/auth/me` as `isAdmin` for the nav link only). Everyone else gets
  404 from `/admin/*`, so the panel does not reveal itself.
- **What "stop" means.** It pauses every running monitor in the workspaces the user **owns** (for the demo user, its demo
  workspace, although it is only a viewer there), using the normal pause (job cancelled, open incident closed, pause
  history written) with a new pause reason `admin`. Workspaces a user was merely invited to are never touched.
- **What "start" means.** It resumes only monitors paused with reason `admin`, so it never overrides a user's own pause or a
  budget pause. A user cannot resume an admin-stopped monitor (403 `STOPPED_BY_ADMIN`), and pausing it again is a no-op,
  so the stop cannot be laundered into a user pause.
- **Listing** returns names, emails, sign-in providers (never tokens or hashes), workspaces with roles, monitor counts and
  the last sign-in, paged (25 by default, 100 at most) and searchable.
- **Limits:** one administrator; no per-monitor control and no deleting users from the panel.
