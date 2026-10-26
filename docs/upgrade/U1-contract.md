# U1 contract: cheap checks + cost visibility

Written at the start of the phase. Backend and frontend build against this in parallel;
neither waits for the other. If something here turns out to be wrong, keep going
with the contract as written and report it at integration.

## File ownership (no one edits another owner's files)

| Owner    | Paths                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| backend  | `packages/shared/**`, `apps/api/**`, `apps/worker/**`, `.env.example`, root `package.json` |
| frontend | `apps/client/**`                                                                           |
| core     | `docs/**`, commits, final validation                                                       |

## Already implemented (by core, before the split)

- `Monitor` model: `type` (`http|heartbeat|agent`, default `http`), `headUnsupported`
  (bool, default false), `costPer1kRequests` (number|null), `currency` (`INR|USD|EUR|GBP`,
  default `INR`).
- `MonitorUsage` model `{ monitorId, workspaceId, month: "YYYY-MM", requests }`, unique
  `{monitorId, month}`; `recordUsage(monitor, count, at)` in `@pulseboard/shared/usage`.
- `@pulseboard/shared/cost` (browser-safe): `SECONDS_PER_MONTH` (30 days),
  `monthKey(date)`, `monthStart(date)`, `estimateMonthlyRequests(monitor)`,
  `estimateRequestsBetween(monitor, from, to)`, `costOf(monitor, requests)`,
  `estimateMonthlyCost(monitor)`. 60 s interval → 43,200 requests/month. Cost is `null`
  when no price is set. Push monitor types (heartbeat/agent) → 0 requests.
- Constants: `MONITOR_TYPES`, `CURRENCIES`, `DEFAULT_CURRENCY`.
- `buildMonitorSchemas().create`: `method` optional → defaults to `keyword ? 'GET' : 'HEAD'`;
  `HEAD` + keyword is a validation error on path `method` ("HEAD responses have no body: use GET
  (or POST) for keyword checks"); `costPer1kRequests` (empty string → null, ≥ 0); `currency`
  default `INR`. `update` accepts the same new fields.
- `runHttpCheck(target, { allowPrivate, appUrl })`: HEAD → GET fallback on 405/501, no body
  download unless a keyword is set, headers `User-Agent: PulseBoard/1.0 (+<appUrl>/bot)` and
  `X-PulseBoard-Check: 1`, result gains `requestsSent` and `headUnsupported`.
- Worker records usage + remembers `headUnsupported`; API "Test now" on a saved monitor records
  usage (unsaved-config tests are not attributable to a monitor, so not counted).
- Env: `APP_URL` (optional, falls back to `DASHBOARD_URL`), `appUrlOf(env)`.

## Backend: remaining U1 work

1. **Usage endpoint** `GET /api/v1/workspaces/:wid/monitors/:mid/usage` (viewer role, 404 for
   other workspaces, in the analytics router). Response:
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
       "headUnsupported": false
     }
   }
   ```
   `estimatedSoFar` = estimate from `max(monthStart, monitor.createdAt)` to now. Costs are
   `null` when `costPer1kRequests` is null.
2. **Migration framework**: `npm run migrate` (root) → `apps/api/scripts/migrate.js` runs
   `apps/api/scripts/migrations/*.js` in name order, records applied names in a `migrations`
   collection, and each migration is idempotent on its own (`$exists: false` filters).
   Migration `001-monitor-types-and-cost.js`: `type: 'http'`, `headUnsupported: false`,
   `costPer1kRequests: null`, `currency: 'INR'` where missing. Never touches `method`.
   Export the migrations so tests can run them against the in-memory DB.
3. `.env.example`: add `APP_URL=` with a comment.
4. **Tests** (update the two assertions that expected `GET` as the default on purpose):
   - shared: cost estimator; schema (HEAD default, GET with keyword, HEAD+keyword rejected,
     cost/currency); runner: HEAD→GET fallback on 405 and 501 (`requestsSent: 2`,
     `headUnsupported: true`), a remembered `headUnsupported` goes straight to GET
     (`requestsSent: 1`), body not downloaded without a keyword (slow/large body finishes fast),
     User-Agent + `X-PulseBoard-Check` received by the server, custom headers can't remove the
     marker, `requestsSent` counts redirect hops.
   - worker: run-check increments `MonitorUsage` and persists `headUnsupported`.
   - api: usage endpoint (shape, estimate, cost null without price, RBAC/404); Test now on a
     saved monitor increments usage; migration is idempotent and leaves `method`, interval,
     status and counters of old-shape monitors untouched.
5. Run `npm run lint` and the shared/api/worker test suites until green.

## Frontend: U1 work

1. **Monitor form** (`MonitorForm.jsx`):
   - New monitors default to `HEAD`; if the user types a keyword while method is HEAD, the
     shared schema reports an error on `method`; show it (and an inline hint suggesting GET).
     Editing an existing monitor keeps its method.
   - New "Cost" card: "Price per 1,000 requests (optional)" number input + currency select
     (`CURRENCIES`, default `INR`).
   - Live estimate under the interval, updating as interval/price/currency change, using
     `estimateMonthlyRequests` / `estimateMonthlyCost` from `@pulseboard/shared/cost`:
     "≈ 43,200 requests/month · ≈ ₹432/month" (cost part only when a price is set).
   - A tip near the URL: recommend a lightweight `/health` endpoint that doesn't touch the
     database or paid services; link to `/bot`.
2. **Monitor detail**: a "Requests & cost" card from the usage endpoint: requests this month,
   estimate so far, monthly estimate, cost (actual and estimated) when a price is set, the
   method in use, and a note when `headUnsupported` ("Server doesn't support HEAD, using GET").
   Configuration card shows the method. Refresh it with the other analytics on live updates
   (key it under `analyticsKey(wid, mid, 'usage')`).
3. **Public `/bot` page** (no login, linked from the User-Agent): what the checker is, the
   exact headers (`User-Agent: PulseBoard/1.0 (+…/bot)`, `X-PulseBoard-Check: 1`), that new
   monitors use HEAD and download no body unless a keyword is set, how to exclude these requests
   from analytics/billing (filter on the header), and how to reduce requests (lightweight
   `/health`, longer intervals; heartbeat/agent monitors coming). Match the polished public
   status page style, dark/light.
4. `formatCurrency(amount, currency)` in `lib/format.js` (`Intl.NumberFormat`, `en-IN` for INR)
   with a unit test.
5. Run client lint (`npx eslint apps/client`), client tests, and `npm run build -w @pulseboard/client`.

## Coordination rules

- Tell the other track only about something that changes their side. Never wait for a
  reply: continue on this contract.
- Commits happen at integration, after validation.
- Hand-off notes: files changed, tests added, anything that deviates from this contract, open
  questions.
