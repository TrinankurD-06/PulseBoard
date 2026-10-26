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
Decisions start at D62 in DECISIONS.md. Agreed defaults: per-type incident thresholds
(heartbeat 1/1, http and agent 3/2), `degraded` shows as operational on public pages,
currency INR.

- [x] **U1. Cheap checks + cost visibility**: HEAD default with GET fallback (405/501,
      remembered), no body without keyword, bot headers + `/bot` page, live cost estimate,
      `MonitorUsage` counting, usage card, idempotent `npm run migrate`. Built by
      backend + frontend tracks in parallel against `docs/upgrade/U1-contract.md`.
- [ ] **U2. Budgets + adaptive intervals**
- [ ] **U3. Heartbeat monitors**
- [ ] **U4. `pulseboard-agent` + probe-on-silence**
- [ ] **U5. Cost & Usage page, cross-type tests, demo, docs**

## Resume note (upgrade)

U1 committed. Validation: Prettier clean, ESLint 0, 315/315 tests (shared 163, api 116,
client 7, demo-target 5, worker 24), client build OK; real run (seed, migrate twice, dev,
browser): HEAD default, live "≈ 43,200 requests/month · ≈ ₹432/month", HEAD+keyword error,
usage card with real counts, `/bot` page, no console errors. Next: U2 (budgets + adaptive
intervals), starting with `docs/upgrade/U2-contract.md`.
