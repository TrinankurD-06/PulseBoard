# Build progress

Tracks the build phases from the project brief. Updated after every step, so work can
resume from here if a session ends. Design reasoning lives in [DECISIONS.md](DECISIONS.md).

Legend: `[x]` done and committed · `[~]` done, not yet committed · `[ ]` to do

## Phases

- [x] **1. Foundation**: `b527646`. Monorepo, shared models (time-series CheckResult, Session),
      Express 5 API skeleton (health, errors, logging), worker skeleton, React/Vite/Tailwind shell.
- [x] **2. Auth & RBAC**: `b6d0589`. JWT access + rotating refresh cookie with reuse detection,
      workspaces/members, `requireRole`, client auth flow, Team/Settings pages.
- [x] **3. Monitors CRUD**: `6fcbff0`. Shared monitor schema, two-layer SSRF guard,
      monitor API + UI, scheduler interface.
- [x] **4. Worker & checks**: `26d7482`. Agenda v6 (API schedules, worker runs), check
      runner with timing breakdown, reconcile on boot, Test now, demo-target (port 4011).
- [x] **5. Incidents & alerts**: `cbdfcb2`. Pure state machine + guarded DB transitions
      (race-tested), alert channels, Discord/Slack/email with 30s/2m/8m retries, Incidents UI.
- [x] **6. Realtime & analytics**: `72d8ccf`. Change streams → Socket.io with resume tokens,
      rollups via `$merge`, uptime/checks/daily endpoints, all monitor charts.
- [x] **7. Status pages**: `146b603`. CRUD, whitelist-only public endpoint with 30s cache,
      polished public page, lazy session restore.
- [x] **8. Polish & ship**: part 1 `94d4362`, part 2 (docs + final pass) `d350ff0`.
      Seed script, Landing page, code splitting, deploy configs, README / ARCHITECTURE / API docs.

## Phase 8 checklist

- [x] Seed script `npm run seed`: demo user `demo@pulseboard.dev / demo1234`, workspace
      "Acme Inc.", 4 monitors, alert channel from `.env`, status page `/status/acme`,
      30 days of rollups + 24h of checks + past incidents. Re-runnable (verified twice).
- [x] UI polish: Landing page, demo-login hint (DEMO_MODE), tab titles, route code splitting
      (no more >500 kB chunk), compact "checked" times on cards, softer uptime label.
- [x] Deploy config: `render.yaml` (API, worker, demo-target), `apps/client/vercel.json`
      (`/api` rewrite + SPA fallback); API honours Render's `PORT`.
- [x] Screenshots in `docs/screenshots/` (taken from a real `npm run seed` + `npm run dev` run).
- [x] `docs/ARCHITECTURE.md`: system, check lifecycle, incident state, alerts, ER diagrams.
- [x] `docs/API.md`: every endpoint with request/response examples.
- [x] `README.md`: overview, features, screenshots, architecture, setup, env table,
      deploy steps, demo script.
- [x] DECISIONS.md entries for phase 8 (D58–D61).
- [x] Final pass: Prettier clean, ESLint exit 0, 281/281 tests, client build without size
      warning, no Redis/queue/other-database dependencies, all 6 Mermaid diagrams render.

## Verification log (end to end, real processes)

- Phase 8 run with `npm run seed` + `npm run dev` against a replica set `rs0` on :27017
  (Docker Desktop was not running, so an in-memory replica set stood in for
  `docker compose up -d`): demo-target set to `down` → dashboard card red after **21 s**
  without reload, "is down" toast, incident opened; set back to `up` → "back up" after
  **20 s**. No browser console errors.

## Resume note

All eight phases are complete. Nothing is in progress.

## Still to verify on your machine

- `docker compose up -d` with Docker Desktop running (not possible in this session).
- Real Discord/Slack alerts need your webhook URL in `SEED_DISCORD_WEBHOOK_URL` /
  `SEED_SLACK_WEBHOOK_URL` (or added on the Alert channels page).
- Deployment to Render + Vercel (needs your accounts; see README → Deploy).

---

# Upgrade: cost-aware, push-first monitoring

Spec: reduce requests sent to customers' endpoints (push-first, pull as fallback).
Decisions start at D62 in DECISIONS.md.

Working rules: commit after each validated phase. Agreed defaults: per-type incident thresholds
(heartbeat 1/1, http and agent 3/2), `degraded` shows as operational on public pages,
currency INR.

- [x] **U1. Cheap checks + cost visibility**: HEAD default with GET fallback (405/501,
      remembered), no body without keyword, bot headers + `/bot` page, live cost estimate,
      `MonitorUsage` counting, usage card, idempotent `npm run migrate`. Built by
      backend + frontend tracks in parallel against `docs/upgrade/U1-contract.md`.
- [x] **U2. Budgets + adaptive intervals**: pure `nextInterval` + EWMA, interval applied to the
      running Agenda job and persisted, budget warning at 80 % / slow or pause at 100 % (exactly
      once), notices, monthly reset with boot catch-up, raise-budget, 409 on resume over budget,
      migration 002, UI (adaptive label, budget banner, raise-budget modal, budget bar).
- [x] **U3. Heartbeat monitors**: ping/fail/start endpoints (per-token rate limit), overdue
      detector (one failure per missed period, atomic), per-type thresholds (heartbeat 1/1),
      incident engine shared by API and worker, CheckResult.source, pings in usage, heartbeat
      form/detail page (ping URL, snippets, ping history), dashboard variant.
- [x] **U4. `pulseboard-agent` + probe-on-silence**: zero-dependency Express SDK (route patterns
      only, bounded memory, zero-traffic reports), hashed agent keys, report endpoint +
      evaluation, AgentReport time-series, silence → 3 probes → incident or `degraded`, external
      check, agent wizard/detail page with live metrics and requests-saved.
- [x] **U5. Cost & Usage page, cross-type tests, demo, docs**: workspace usage endpoint (one
      aggregation, per-currency costs) and page (stat tiles, sortable table, budget bars, month
      selector), cross-type integration tests, seed with one monitor of each type + demo file,
      demo-target running the agent with crash / agent-silent / 5xx / restore scenarios and
      internal traffic, heartbeat cron script, docs (README, ARCHITECTURE diagrams, API, D85–D87).

## Definition of done: verified 27 Oct (real run: migrate, seed, `npm run dev`)

- [x] Existing http monitor unchanged by `npm run migrate` (method, interval, status, counters
      kept; `adaptive: false`); second run is a no-op.
- [x] New http monitor defaults to HEAD + adaptive; estimate 43,200 requests ≈ ₹21.6/month.
- [x] Heartbeat: pings stop → incident after 108 s (1 min + 30 s grace + detector), alert
      queued; next ping resolves it; `--fail` opens one with the job's message.
- [x] Demo-target agent reports live metrics (route patterns only); crash → 3 probes →
      incident + alert after 84 s; restore → resolved in 60 s; agent silent → degraded after
      63 s with one notice and no incident.
- [x] Cost & Usage page shows 86,400 requests saved, per-currency costs; renders without
      console errors or sideways scrolling at 1360 and 390 px.
- [x] Gate: 571/571 tests (agent 24, shared 228, api 181, client 57, demo-target 22, worker 59),
      ESLint and Prettier clean, client build OK.

## Resume note (upgrade)

Upgrade complete: U1 `9fc020d`, U2 `256d24b`, U3 `b6389a2`, U4 `086c3f4`, U5 `b9146d7`. Committed after
this note. Nothing pushed yet.
