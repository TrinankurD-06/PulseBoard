# U2 contract: budgets + adaptive intervals (http monitors)

Written at the start of the phase. Backend and frontend build against this in parallel; neither
waits for the other. Same ownership and coordination rules as U1
([U1-contract.md](U1-contract.md)): backend owns `packages/shared/**`, `apps/api/**`,
`apps/worker/**`, `.env.example`, root `package.json`; frontend owns `apps/client/**`;
integration owns `docs/**`, validation and commits. Never block waiting on the other track.

## Data model (Monitor, http only)

| Field                  | Type                                  | Default (model / existing)      | New monitors (schema)                   |
| ---------------------- | ------------------------------------- | ------------------------------- | --------------------------------------- |
| `adaptive`             | bool                                  | `false`                         | `true`                                  |
| `minIntervalSec`       | number                                | 30                              | mode minimum (10 in DEMO_MODE, else 30) |
| `maxIntervalSec`       | number                                | 600                             | 600                                     |
| `currentIntervalSec`   | number \| null                        | `null` → treat as `intervalSec` | = `intervalSec`                         |
| `responseEwmaMs`       | number \| null                        | `null`                          | (worker-managed)                        |
| `responseEwmaAt`       | Date \| null                          | `null`                          | (worker-managed)                        |
| `monthlyRequestBudget` | number \| null (int ≥ 1)              | `null` (no budget)              | optional                                |
| `budgetAction`         | `'slow' \| 'pause'`                   | `'slow'`                        | `'slow'`                                |
| `budgetExceededMonth`  | `"YYYY-MM"` \| null                   | `null`                          | (worker-managed)                        |
| `pausedReason`         | `null \| 'user' \| 'budget_exceeded'` | `null`                          | (set on pause)                          |

`intervalSec` stays the **base** interval. `currentIntervalSec` is what the Agenda job
actually uses. Schema rules: `minIntervalSec ≥ mode minimum`, `minIntervalSec ≤ intervalSec ≤
maxIntervalSec`, `maxIntervalSec ≤ MAX_INTERVAL_SEC`; when `adaptive`, the timeout must fit in
`minIntervalSec` (checks can run that often). `MonitorUsage` gains `warnedAt` and
`exceededAt` (Date | null): "sent once per month" markers, set atomically.

Constants: `ADAPTIVE_SUCCESS_RUN = 10`, `BUDGET_WARNING_RATIO = 0.8`,
`BUDGET_SLOW_INTERVAL_SEC = 900`, `BUDGET_ACTIONS = ['slow', 'pause']`.

## Pure functions (shared, unit-tested)

- `nextInterval(monitor, lastResult)`, with `monitor` being the state **after** the incident
  engine counted the check (status, `consecutiveSuccesses`, `currentIntervalSec`,
  `intervalSec`, `minIntervalSec`, `maxIntervalSec`, `responseEwmaMs`):
  1. not `adaptive` → `intervalSec` (unchanged behaviour);
  2. budget-slowed this month → `max(BUDGET_SLOW_INTERVAL_SEC, maxIntervalSec)`;
  3. `lastResult.ok === false` → `minIntervalSec`;
  4. status `down` → `minIntervalSec`;
  5. response time > 2 × `responseEwmaMs` (only when an average exists) → `min(current, intervalSec)`
     (a spike pulls a backed-off interval back to the base, never slows a fast one);
  6. status `up` and `consecutiveSuccesses % ADAPTIVE_SUCCESS_RUN === 0` → `min(current × 2, maxIntervalSec)`;
  7. otherwise `current`.
- `updateResponseEwma(prevMs, prevAt, sampleMs, at)`: time-weighted moving average with a
  24 h time constant (approximates the "24 h average" without querying raw checks).
- `budgetState(requests, budget)` → `'none' | 'ok' | 'warning' | 'exceeded'`
  (warning at ≥ 80 %, exceeded at ≥ 100 %).
- `budgetSlowIntervalSec(monitor)` = `max(BUDGET_SLOW_INTERVAL_SEC, maxIntervalSec)`.

## Backend work

1. Model fields, constants, schema (create/update + cross-field rules above), migration
   `002-adaptive-and-budget.js`: for existing docs set `adaptive: false`,
   `currentIntervalSec = intervalSec` (pipeline update), `minIntervalSec = min(30, intervalSec)`,
   `maxIntervalSec = max(600, intervalSec)`, `monthlyRequestBudget: null`, `budgetAction: 'slow'`,
   `budgetExceededMonth: null`, `pausedReason: isPaused ? 'user' : null`, only where missing.
2. **Scheduling uses the current interval everywhere**: `scheduleMonitor` and the boot
   reconcile must use `currentIntervalSec ?? intervalSec` (otherwise they reset adaptive
   intervals). The API resets `currentIntervalSec` to the new `intervalSec` when the base
   interval or `adaptive` changes, and on resume.
3. **Adaptive rescheduling in the worker** after each check: compute `nextInterval`; if it
   changed, store `currentIntervalSec` and apply it to the **running job**: set
   `job.attrs.repeatInterval` and `job.attrs.nextRunAt = lastRunAt + n s` in memory (Agenda
   re-saves `nextRunAt` from memory after the run, see D-entries), and persist
   `repeatInterval` in `agendaJobs` (Agenda's post-run save does not write it). Put the
   helper in `@pulseboard/shared/scheduling`. Update the EWMA in the same step. Include
   `currentIntervalSec` in the monitor change-stream `$match` and in the live payload
   whitelist (plus `pausedReason`, `budgetExceededMonth`, `adaptive`). The incident engine
   should return the post-check monitor state it computed, so the worker needs no extra read.
   The 3-failure / 2-success incident rules must not change.
4. **Budget enforcement** after `recordUsage` (make it return the new count):
   - ≥ 80 %: atomically set `MonitorUsage.warnedAt` (only if null); the winner queues a
     `budget_warning` notice to every enabled channel.
   - ≥ 100 %: atomically set `exceededAt`; the winner applies the action:
     `pause` → `isPaused: true`, `status: 'paused'`, `pausedReason: 'budget_exceeded'`,
     `budgetExceededMonth: <month>`, cancel the job, close an open incident (no recovery alert);
     `slow` → `budgetExceededMonth: <month>`, `currentIntervalSec = budgetSlowIntervalSec`,
     apply to the running job. Queue a `budget_exceeded` notice either way.
5. **Notices** (alerts that aren't incidents): new Agenda job `send-notice`
   `{ monitorId, channelId, kind, month, attempt }`, kinds `budget_warning | budget_exceeded`
   (U4 adds `degraded`), same senders and 30 s / 2 min / 8 min retries as `send-alert`,
   `buildNotice()` in shared alerts (amber styling, monitor name, used/budget, action taken,
   dashboard link).
6. **Monthly reset**: Agenda job `budget-reset` at `0 0 1 * *` UTC **and** once at worker
   boot (catch-up): monitors with `budgetExceededMonth` ≠ current month → if
   `pausedReason === 'budget_exceeded'` resume (pending, counters reset, reschedule), if slowed
   restore `currentIntervalSec = intervalSec` and reschedule; clear `budgetExceededMonth`.
   Never touches user-paused monitors.
7. **API**:
   - PATCH raising `monthlyRequestBudget` above this month's usage lifts the restriction
     immediately (resume / restore interval, clear `budgetExceededMonth`, clear `exceededAt`
     and, if below 80 %, `warnedAt`). Members/owners only (existing PATCH RBAC).
   - `POST /resume` on a monitor paused by budget that is still over budget →
     `409 { code: 'BUDGET_EXCEEDED', message: 'Raise the monthly budget to resume this monitor' }`.
   - User pause sets `pausedReason: 'user'`; resume clears it.
   - Usage endpoint adds:
     ```json
     "budget": { "monthlyRequestBudget": 20000, "budgetAction": "slow", "usedRatio": 0.82,
                 "state": "warning", "exceededThisMonth": false },
     "interval": { "adaptive": true, "intervalSec": 60, "currentIntervalSec": 240,
                   "minIntervalSec": 30, "maxIntervalSec": 600, "slowedByBudget": false }
     ```
8. Tests (spec list): `nextInterval` (all rules incl. caps and order), EWMA, `budgetState`;
   integration: adaptive interval applied to the running job and persisted (and boot reconcile
   keeps it); 80 % warning queued exactly once; 100 % pause and slow; monthly reset restores
   (and leaves user-paused alone); raising the budget lifts a pause; resume while over budget →
   409; viewer can't PATCH budget; incident thresholds unchanged with adaptive on; migration 002
   idempotent.

## Frontend work

1. **Form**: "Adaptive interval" switch (default on for new monitors) with a one-line
   explanation; when on, "Fastest" (`minIntervalSec`) and "Slowest" (`maxIntervalSec`) selects
   from the interval presets (respecting `/meta` `minIntervalSec`); the cost estimate line says
   it's an upper bound when adaptive ("at most ≈ 43,200 requests/month"). New "Budget" fields
   in the Cost card: "Monthly request budget (optional)" + "When the budget is reached":
   Slow down to every 15 min / Pause until next month; show "≈ estimate vs budget" hint when
   the estimate exceeds the budget.
2. **Interval display**: dashboard card interval cell shows the current interval with an
   "adaptive" marker (e.g. `4m · adaptive`); monitor detail Configuration shows
   "Checking every 4 min (adaptive, base 1 min, 30 s–10 min)" or "every 15 min (slowed: budget
   reached)".
3. **Budget banner** on monitor detail, from the usage endpoint:
   warning (≥ 80 %): amber "82 % of this month's request budget used";
   exceeded + slow: "Monthly budget reached: checking every 15 min until 1 Nov";
   exceeded + pause / `pausedReason: 'budget_exceeded'`: "Paused: monthly request budget
   reached". Members/owners get a "Raise budget" action (small modal with a number field →
   PATCH `monthlyRequestBudget`); viewers see the banner only. Resume is hidden/disabled with an
   explanation while paused by budget.
4. **Usage card**: budget progress bar (text label + percentage, colour never the only cue).
5. Toast + query refresh still work through live updates (`currentIntervalSec` arrives in
   `check:result`).
6. Lint, client tests (add tests for any new pure helpers, e.g. interval label formatting),
   build.

## Coordination

- The frontend must not wait for backend: build against the field names and payloads above.
- If you change a field name or payload, tell the other track (never wait for a reply)
  and list it in the hand-off notes.
- Commits happen at integration. Hand-off notes: files, tests (counts), deviations, open
  questions.
