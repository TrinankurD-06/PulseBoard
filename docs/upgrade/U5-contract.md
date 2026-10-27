# U5 contract: Cost & Usage page, cross-type guarantees, demo, docs

Written at the start of the phase. Ownership for U5:

| Owner    | Paths                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| backend  | `packages/shared/**`, `apps/api/**` (incl. `apps/api/scripts/seed.js`), `apps/worker/**`, `.env.example`, root `package.json` |
| frontend | `apps/client/**`, `apps/demo-target/**`, `packages/agent/**`                                                                  |
| core     | `docs/**`, `README.md`, validation, commits                                                                                   |

Coordination as before: never block on the other track; tell it only about changes that affect
the other side; real-thing tests where Agenda or processes are involved; commits only at
integration; no servers or stray files left behind.

## 1. Workspace Cost & Usage (backend endpoint, frontend page)

`GET /api/v1/workspaces/:wid/usage?month=YYYY-MM` (viewer; default current UTC month):

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
        "intervalLabelSec": 60,
        "adaptive": false,
        "currentIntervalSec": null,
        "requests": 12,
        "estimatedMonthlyRequests": 0,
        "requestsSaved": 43200,
        "pings": 0,
        "reports": 1440,
        "costPer1kRequests": 0.5,
        "currency": "INR",
        "actualCost": 0.01,
        "estimatedMonthlyCost": 0,
        "budget": { "monthlyRequestBudget": null, "usedRatio": null, "state": "none" }
      }
    ]
  }
}
```

- `intervalLabelSec`: http → current (adaptive) interval or base; heartbeat → `expectedEverySec`;
  agent → `reportEverySec`. `requestsSaved` uses `estimateRequestsSaved` (vs 1-minute polling).
- Costs are summed **per currency** (never converted).
- One aggregation for the usage docs of the month + one monitor query (no per-monitor queries).

**Client page** `/app/:wid/usage`, sidebar item "Cost & usage":

- Totals at the top (stat tiles): requests sent this month, requests saved vs 1-minute polling,
  estimated monthly requests, cost per currency.
- Table per monitor: name (link), type badge, status, current interval (with "adaptive" /
  "slowed" markers), requests this month, estimated cost, budget usage bar (text + %, colour
  never the only cue), requests saved. Sortable by requests and cost; month selector (current
  and previous months); empty state; table works on mobile (horizontal scroll inside the card,
  not the page).

## 2. Same guarantees for all three monitor types (backend tests)

One integration test file proving, for an http, a heartbeat and an agent monitor:
uptime %, daily rollups (`rollupDay`), 90-day series, the public status page (and that it leaks
nothing: no URLs, tokens, key hashes, probe URLs), incident open/resolve and alert jobs queued
for enabled channels all work identically.

## 3. Demo (frontend owns demo-target; backend owns the seed)

- `apps/demo-target` depends on `pulseboard-agent` (workspace dependency) and uses it when an
  agent key is available: from env `PULSEBOARD_AGENT_KEY` + `PULSEBOARD_ENDPOINT`, else from the
  git-ignored file `apps/demo-target/.pulseboard-demo.json` written by the seed
  (`{ "agentKey": "…", "endpoint": "http://localhost:4000/api/v1", "heartbeatUrl": "…" }`).
  Without a key it runs as today (no agent).
- `/admin` gains toggles: **crash** (agent stops reporting _and_ the site drops connections,
  so probes fail → incident), **agent silent** (agent stops, site keeps serving → degraded),
  **5xx errors** (existing `error500`, now also visible in agent metrics), **restore** (site up
  and a fresh agent instance reporting again). Show the current agent state on the page.
  Generate a little background traffic in the demo-target itself (e.g. an internal request every
  second) so the agent charts move without a load generator, and say so on the page.
- `apps/demo-target/scripts/heartbeat-cron.js` (`npm run heartbeat -w @pulseboard/demo-target`):
  pings the heartbeat URL every N seconds (`/start` then ping), reads the URL from env
  `HEARTBEAT_URL` or the seed file; flags `--fail` (send `/fail`) and `--stop-after <n>`.
  Root `npm run dev` should **not** start it (the demo starts it by hand to show "pings stop →
  incident").
- **Seed** (`apps/api/scripts/seed.js`): keep the existing http monitors (switch the public sites
  to `HEAD`, keep the demo-target http monitor non-adaptive), add one **heartbeat** ("Nightly
  backup", expected every 60 s in DEMO_MODE / 1 h otherwise, grace 30 s) and one **agent**
  ("Checkout API (agent)", report every 30 s in DEMO_MODE / 60 s, probeUrl = demo-target URL),
  some realistic history for both (rollups + recent results with the right `source`), add both
  to the status page, write `apps/demo-target/.pulseboard-demo.json` with the agent key and the
  heartbeat URL (and add it to `.gitignore`), and print them. Still idempotent.

## 4. Docs (core)

README (monitor types, cost features, agent install), ARCHITECTURE.md (push vs pull Mermaid
diagram, probe-on-silence sequence diagram), API.md (ping, agent report, agent-metrics,
workspace usage, new monitor fields), DECISIONS.md, PROGRESS.md.
