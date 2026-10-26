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
