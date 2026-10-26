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
