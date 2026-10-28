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

Upgrade complete: U1 `f6303c4`, U2 `2b93f45`, U3 `004bb2f`, U4 `7f2741f`, U5 `152dada`. Committed after
this note. Nothing pushed yet.

---

# Theme + OAuth preparation (27 Oct)

User request: light mode in peach / very pale orange with pops of green, blue and red; dark mode
black with pale-orange accents; 3D effects here and there; prepare for OAuth. Dev now runs
against the user's MongoDB Atlas (`MONGODB_URI` in `.env`), no Docker needed.

- [x] **T1. Warm theme + 3D**: slate remapped to a warm scale, `brand` palette that flips by mode
      (green light / pale orange dark), emerald split into brand vs status, chart tokens
      re-validated (CVD pass both modes), 3D buttons/cards/landing preview with reduced-motion
      fallback (D88).
- [x] **T2. OAuth prepared**: Google + GitHub enabled only when credentials are set, HMAC-signed
      state cookie + PKCE S256, link by verified email only, `identities` on User + migration 003,
      client buttons (hidden until a provider is configured) and `/auth/callback` page (D89).
- [x] Gate: 618/618 tests (agent 24, shared 230, api 222, client 61, demo-target 22, worker 59),
      ESLint and Prettier clean, client build OK; live API on Atlas healthy, providers `[]`.

## Resume note (theme + OAuth)

Done and committed locally (two commits: OAuth server, then theme + OAuth client). Nothing pushed.
To go live with OAuth: README → "Sign in with Google/GitHub".

---

# UI redesign: "Dark Editorial" + per-monitor Health deck

Decisions from D91. Commit after each phase; nothing pushed unless asked.

- [x] **R1. Audit and plan**: approved (React 19, shadcn `tsx:false`, contrast fixes, old theme dropped).
- [x] **R2. Tokens and foundations**: React 19.3 (`ceec26f`, also fixed dev-mode client builds),
      tokens.css + Tailwind/shadcn mapping, fonts, grain, halftone, data-theme switch (`135e068`).
- [x] **R3–R5, R7, R8**: superseded by the "Ambient Signal" redesign below (V3, V6, V7, V8).
- [x] **R6. Health deck**: own Recharts component,
      GET /monitors/:mid/metrics, live updates, keyboard radiogroup (D92, D93).

---

# UI v2: "Ambient Signal" (replaces the Dark Editorial plan above)

Decisions from D94. Dark only. Commit after each phase; nothing pushed unless asked.
Defaults agreed: raw WebGL signal field (2D canvas fallback), `--text-faint` #7C7B71, public status
page wave driven by status only (the public endpoint exposes no latency), uptime SLA target 99.9%.

- [x] **V1. Audit and plan**
- [x] **V2. Tokens, fonts, ambient glow; old theme, light mode, grain removed** (D94). A transitional
      bridge keeps unrebuilt pages readable; it is deleted in V6.
- [x] **V3. Header line + nav + shell; primitives** (D95) (ring-dot, CTA, outline cards, pills, inputs, toasts,
      modals, skeletons, empty states, Recharts theme)
- [x] **V4. Radial tick gauge + stepped cards** (gauge maths unit-tested)
- [x] **V5. Signal field** (WebGL + 2D fallback, live data, limits, reduced motion, lazy-loaded;
      on the dashboard, landing and status pages)
- [x] **V6. App pages** (+ Health deck restyle; bridge and `dark:` variant removed, D97)
- [x] **V7. Landing + public status page + auth** (D97)
- [x] **V8. QA**: README screenshots retaken from the live site, pages checked in a browser at 1440 and
      390 px, error pages and alert emails checked. **Not done:** the Lighthouse run (targets: performance
      ≥ 85, accessibility ≥ 90).

---

# Live deployment and what followed

- **Hosting:** frontend on Vercel (`vercel.json` at the repo root proxies `/api` to Render), API and
  worker in one free Render web service (`RUN_MODE=combined`, D96), data on MongoDB Atlas.
- **Sign-in:** Google and GitHub work on the live site (GitHub needs its own OAuth app, one callback URL
  per app). OAuth ids and secrets are trimmed, because a pasted newline broke GitHub (`0a9dcec`).
- **Email alerts:** over Resend's HTTPS API (`RESEND_API_KEY`), since Render's free plan blocks SMTP
  (D98). Until a domain is verified Resend delivers only to the account owner's address.
- **Alerts and errors (D100):** test alerts link to the Alert channels page, one module builds every
  alert link, error pages render exactly one layout, the alert email is in the dark theme, and the Test
  button shows its result on the row.
- **Seed (D99):** local-only demo monitors are created only for a local database.
- **Keep-alive:** an external monitor requests `/health` every 10 minutes so the free service does not
  sleep (the service stops checking while asleep).
- **Tests:** 794 across six workspaces (agent 24, shared 255, API 257, client 175, demo-target 22,
  worker 61); ESLint, Prettier and the client build are clean.

## Resume note

Everything above is deployed and pushed. Optional follow-ups: the Lighthouse pass, a light/dark toggle
(done, see "Light theme" below), confirm dialogs in the new style instead of `window.confirm`
for deletes, and making two timing-sensitive tests more robust (they failed once each under load).

---

# Uptime accuracy, errors and sample data (D101, 28 Oct)

Committed locally (`ea6b976`, `3249801`, `1526e82`, `bde8ac3`); not pushed.

- [x] **Uptime from confirmed downtime.** `100 x (1 - incident downtime / time watched)`; failed checks that never
      opened an incident no longer lower it. A monitor with no results shows "no data", not 100 %. Same maths on the
      monitor page, 90-day bars, Health deck, dashboard gauge (new `GET /monitors/uptime-summary`) and public page.
- [x] **Checker-offline state.** A network failure is probed against two reference hosts; if both fail the result is
      `unknown` / `checker_offline`, kept out of incidents, adaptive intervals, budgets and every count, and drawn as a
      gap labelled "Checker offline".
- [x] **Recorded errors.** `errorCode` on every failed result, `causeCode` on incidents, shown in the timeline and the
      Health deck's failed-checks panel.
- [x] **Sample data.** Fake history only for four fictional demo monitors, all flagged `isSeed`; "Sample data" badges in
      the UI; `npm run seed:clear` removes it. Migrations 004 (flag old fake history) and 005 (`coveredSec` backfill).
- [x] Clean chart gaps (contiguous runs, no lines across gaps). Docs: D101, API.md, README.

**To do on the live database:** run `npm run migrate` once (004, 005) so older data is flagged and backfilled.

---

# Light theme (28 Oct)

Decision D102. Nothing pushed.

- [x] Light tokens under `[data-theme='light']` (peach paper, ink, vivid green accent, `--series` for gauges and chart lines); contrast tested in both themes.
- [x] Theme provider and `ThemeToggle` (app header, public/auth headers, error pages); stored choice, else the OS
      preference; inline script in `index.html` prevents a flash.
- [x] Signal field blends normally in light (`--field-blend`), recoloured live on a theme change; toasts follow the theme.
- [x] Gate: client 227/227 tests, ESLint and Prettier clean, client build OK. Landing page checked in both themes in
      headless Chrome.
- [ ] **Not checked in a browser:** the logged-in app pages (dashboard, monitor detail, charts, modals) in light mode,
      since they need the API and a database. Worth a click-through.

## Resume note (light theme)

Done except the click-through above. The alert email is still dark-only on purpose.
