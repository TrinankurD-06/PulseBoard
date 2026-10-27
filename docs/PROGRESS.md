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
- [ ] **U4. `pulseboard-agent` + probe-on-silence**
- [ ] **U5. Cost & Usage page, cross-type tests, demo, docs**

## Resume note (upgrade)

U1 `9fc020d`, U2 `256d24b`, U3 committed. U3 gate: 429/429 tests (shared 208, api 144,
client 26, demo-target 5, worker 46), lint/Prettier clean, build OK; real run verified pings,
missed period → incident in 44 s, recovery, /fail, regenerate, 0 requests sent.
Next: U4 (agent package + probe-on-silence), contract already written in
`docs/upgrade/U4-contract.md`: backend + frontend(+SDK) tracks.
