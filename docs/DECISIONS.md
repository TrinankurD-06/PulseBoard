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
