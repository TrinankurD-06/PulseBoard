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
- [x] **Logged-in pages checked in light mode (29 Oct)**, headless Chrome against the local API on Atlas, demo account, at 1440 and
      390 px: dashboard, monitor detail (Health deck, expanded chart, incidents), incidents, alert channels, status pages, cost
      & usage, team, settings, new monitor (website, heartbeat and agent forms), public status page. No console errors, no
      sideways scroll, no dark leftovers, no text under WCAG AA contrast. Not covered: the heartbeat and agent _detail_ pages
      (the live data has no such monitor), confirm dialogs, and hover tooltips.
- Seen, not light-specific, both fixed: the last x-axis label of the large charts was clipped at the right edge (right chart
  margin 8 to 32 px, checked on 108 axes), and the uptime gauge ring was fully red below the 99.9 % target (99.78 % on a
  healthy dashboard). The ring now follows the uptime bands: green at 99.9 % and above, amber from 99 % (`warnTarget`,
  `UPTIME_WARN_TARGET`), red below 99 %. Dashboard, monitor page and public status page; the Usage budget gauges are unchanged.

## Resume note (light theme)

Done except the click-through above. The alert email is still dark-only on purpose.

---

# One uptime formula (D103, 28 Oct)

Fixes the monitor page showing a 30-day gauge of 100.0 next to a 24-hour card of 99.95 with a dip.

- [x] `computeUptimeFromParts` / `computeUptime`: `1 - confirmed incident downtime / watched time`, leaving out paused
      time (new `Monitor.pauses`, written on every pause and resume) and checker-offline time. Check-count
      `uptimePercent` removed.
- [x] Used by the tiles, Health deck card and sparkline, dashboard and public gauges, 90-day bars, status pages,
      rollups (`rollupDay`) and the metrics endpoint. Today is computed live; the card covers exactly the selected range.
- [x] Cut, never rounded: 100 only when downtime is exactly 0; one `formatUptime` (2 decimals) and `uptimeGaugeProps`.
- [x] Card label shows its range; gauge stays at 30 days and says so; change reads `±0.00%` / percentage points.
- [x] `npm run rollups:rebuild` (`rebuildAllRollups`).
- [x] Gate: 940 tests (agent 24, shared 299, API 289, client 233, demo-target 22, worker 72), ESLint and Prettier clean,
      client build OK.
- [x] `npm run rollups:rebuild` run on the live database (28 Oct): 12 rollups over 2 days (27 and 28 Oct) recalculated.

---

# Demo incident monitor (28 Oct)

- [x] `npm run seed:demo-incidents` adds one fictional monitor, "Demo Checkout API", with 5 resolved incidents
      (503, timeout, missing keyword with a failed-then-retried alert, refused, 500), 24 h of checks, 30 days of
      rollups and usage to the demo account's workspace. Additive (removes nothing), everything flagged `isSeed`
      ("Sample data"), removed by `npm run seed:clear`, replaced if run twice. Not scheduled, so no real checks or alerts.
- [x] Run on the live database for demo@pulseboard.dev / "Acme Inc.".

# pulseboard-agent: production-ready package (29 Oct)

Not committed yet; nothing published. The name `pulseboard-agent` was free on npm (404) on 29 Oct.

- [x] Build: rolldown (dev dependency) bundles `src` to `dist/index.js` (ESM) and `dist/index.cjs`, plus `.d.ts` / `.d.cts`
      (checked with `tsc --strict`). `package.json`: exports map, files (dist, README, LICENSE), sideEffects false,
      optional express peer, MIT, repository/bugs/homepage, `prepublishOnly` = build + test.
- [x] Behaviour: bad options throw at start-up; `intervalSec` (alias `reportEverySec`), `serviceName`, `debug`;
      one warning per outage; `beforeExit` flush; `heartbeat(apiKey, endpoint)`; ids in mount paths masked; routes
      capped at 300 characters (the API rejects longer). The API accepts and stores `serviceName`.
- [x] Tests: 49 in the package (percentiles, aggregation, heartbeat, failure path, no PII, unref, supertest, CJS/ESM dist).
- [x] LICENSE, CHANGELOG, README rewritten. The wizard snippet and demo-target use `intervalSec`.
- [x] Demo-target imports the package by name, which now resolves to `dist`: its `predev` and `pretest` build it first.
- Gate: 968 tests, ESLint and Prettier clean, client build OK, `npm pack --dry-run`: 7 files, 12.5 kB.

## Published (29 Oct)

`pulseboard-agent@1.0.0` is live on npm (MIT, `latest`). Checked by installing it from the registry:
`require` and `import` both load, and a missing `apiKey` throws the clear error. The registry also
lists a `0.0.0-stage` placeholder, created when the name was reserved.

Releasing a new version, from `packages/agent`:

1. Bump `version` in `package.json` and `AGENT_VERSION` in `src/options.js` (a test fails if they differ).
2. Add an entry to `CHANGELOG.md`.
3. `npm test`, then `npm publish --access public` (needs the 2FA code), then `npm view pulseboard-agent version`.
4. Commit and tag: `git tag agent-v<version>`.

---

# Docs and polish + read-only demo (29 Oct)

No feature changes beyond the read-only demo safety. Base commit `8c85f2d`. Built by a four-agent team
(backend, frontend, tester, orchestrator).

## Task board

- [x] Demo walkthrough moved from the README to `docs/DEMO.md`.
- [x] Email provider wording: Resend everywhere, `.env.example`, `render.yaml`, tech stack, D104.
- [x] Landing stat label: "Requests sent to push-monitored endpoints".
- [x] Shared demo module (`ensureReadOnlyDemo`, `resetDemoData`), constants, env fields, `/meta` fields, `POST /workspaces` guard.
- [x] Backend: worker `demo-reset` job and registration, worker start test (4200367).
- [x] Frontend commit 2419ee8; shared+API guard 08e13d7.
- [x] Backend: seed script uses the shared module; re-seeding does not duplicate workspaces (`scripts/lib/seedDemoAccount.js`).
- [x] Backend: tests (shared, API 403/200, `/meta`, env, demo-target `/admin`, worker).
- [x] Frontend: `lib/demo.js` and test, `DemoBanner`, Login uses shared constants (240 client tests, lint, build clean). Checked in a browser (banner in dark and light at 1440 and 390 px, absent when the flag is off).
- [x] Tester: commits and pushes, final verification (tests, ESLint, Prettier, build, greps).
- [x] Orchestrator: D105 checked against the final code, summary.

## Summary (29 Oct)

Nine commits on `main`, `8c85f2d..4a68892` (39 files, +1031 / -136): `47f075b` docs and config, `8fe422f` client copy,
`08e13d7` shared demo module and guards, `4200367` demo-reset job, `2419ee8` client banner, `e94d560` and `4a68892` progress and
decisions, `62714fa` decisions wording, `3a9be18` seed helper. Gate on the pushed head: agent 49, shared 315, API 310, client 240,
demo-target 23, worker 77 tests; ESLint and Prettier clean; client and agent builds pass. Not run against the live database.

**1. Demo walkthrough:** `README.md` (sections replaced by one line), `docs/DEMO.md` (new: intro, "Before you start" checklist, the
walkthrough).
**2. Resend:** `README.md` (overview, features, diagram, tech stack, env table, deploy), `.env.example` (Resend variables; SMTP_* only as a
commented optional fallback), `render.yaml` (SMTP_* removed, `DEMO_READ_ONLY` and `DEMO_OWNER_EMAIL` added), `docs/API.md`,
`docs/ARCHITECTURE.md`, `apps/client/src/pages/AlertChannels.jsx` (hint), `apps/api/scripts/seed.js` and
`packages/shared/src/demo/demoIncidents.js` (comments and sample alert text), `docs/DECISIONS.md` (D104).
**3. Landing label:** `apps/client/src/pages/Landing.jsx`.
**4. Read-only demo:**

- shared: `src/demo/index.js` (new), `src/demo/demoIncidents.js` (moved from the API scripts), `src/constants.js`, `src/env.js`,
  `package.json` (`./demo` export), tests `demo.test.js`, `env.test.js`.
- API: `src/app.js`, `src/config/env.js`, `src/modules/meta/meta.routes.js`, `src/modules/workspaces/workspaces.routes.js`,
  `scripts/seed.js`, `scripts/lib/seedDemoAccount.js` (new), `scripts/seed-demo-incidents.js`, tests `demoReadOnly.test.js` (new),
  `seed.test.js`, `env.test.js`, `demoIncidents.test.js`.
- worker: `src/jobs/demoReset.js` (new), `src/worker.js`, `src/config/env.js`, tests `demoReset.test.js` (new), `start.test.js`.
- demo-target: test only (`/admin` needs no auth or API).
- client: `lib/demo.js` and `demo.test.js` (new), `components/layout/DemoBanner.jsx` (new), `AppShell.jsx`, `pages/auth/Login.jsx`.
- docs: `docs/DECISIONS.md` (D105), this file.
  **5. Verification:** "Brevo", "Sent by push monitors" and the brand name: no hits in tracked files. "SMTP_" remains only where it is
  real: `.env.example` (commented fallback), the README env-table row, `packages/shared/src/env.js` and `alerts/email.js` (the SMTP
  fallback code), tests, and the D98/D104 history.

**Deliberate differences from the brief**

- "Brevo" never existed in the repo.
- `SMTP_*` is not unused: the nodemailer fallback and the Ethereal local test inbox still run on it, so it stays in code and
  tests; removing it would be a feature change. The real sender variable is `ALERT_FROM_EMAIL` (there is no `MAIL_FROM`).
- `DEMO_READ_ONLY` defaults to `false` so the local demo account stays editable; `render.yaml` sets it to `true`.

**Manual steps for you**

1. On the live Render service set `DEMO_READ_ONLY=true` (an existing service may not pick up the new `render.yaml` variable on its own),
   optionally `DEMO_OWNER_EMAIL` (an existing account that should own the demo workspace), and redeploy. The first worker boot
   makes `demo@pulseboard.dev` a Viewer in "Acme Inc."; without `DEMO_OWNER_EMAIL` a password-less `demo-owner@pulseboard.dev` becomes its
   owner. If you want to manage that workspace yourself, set `DEMO_OWNER_EMAIL` to your own account first.
2. The daily reset (03:00 UTC) rebuilds only the sample "Demo Checkout API" monitor; real monitors are untouched.
3. Not done: running any of this against the live database, and the Lighthouse run, styled delete confirmations and two flaky
   timing tests from earlier notes.

---

# Leftovers closed (29 Oct)

Done directly, two tasks at a time, with memory kept well under the 95 % ceiling (65 to 66 % at the peak).

- [x] **Lighthouse** (production build via `vite preview`, API on Atlas, mobile profile, public pages only): Landing 94 / 100 / 100,
      Login 97 / 100 / 96, public status page 90 / 100 / 100 (performance / accessibility / best practices). Targets (performance 85,
      accessibility 90) met; no fixes needed. Login's 96 is the expected 401 on the token refresh when nobody is signed in. The
      logged-in pages were not measured (they need a session).
- [x] **Styled delete confirmations** (`cdab1af`): `lib/confirm.js` (promise-based controller, 5 unit tests), `ConfirmProvider` and
      `useConfirm()`, used for deleting a channel, a monitor and a status page, and removing a member. Cancel is focused first, Esc and
      a click outside cancel. Checked in a browser with the DELETE requests intercepted: Esc and Enter on Cancel delete nothing, the
      confirm click sends exactly one request, no `window.confirm` is left. 245 client tests.
- [x] **Timing-sensitive tests: not reproduced, left unchanged.** Two rounds of the API (310), worker (77) and shared (315) suites ran
      with 14 busy-loop processes saturating 16 cores: no failures. A suspect (`crossType.test.js`, which assumes under a second has
      passed) still passed with a 2.5 s pause inserted, so it is not time-sensitive that way. If a failure shows up again, keep its
      output (test name and assertion) before changing anything.
- [x] **Lighthouse, logged-in pages** (same setup, signed in as the demo user, mobile profile; performance / accessibility / best practices):
      dashboard 97 / 98 / 100, incidents 99 / 98 / 100, cost & usage 99 / 100 / 100, **monitor detail 60 / 97 / 100** (LCP 4.4 s,
      total blocking time 1.39 s, CLS 0.023). Monitor detail misses the performance target of 85: it is the heaviest page (the
      Health deck and chart library; forced reflow and unused JavaScript are flagged). Not fixed yet. Minor accessibility items:
      heading order on the dashboard and incidents pages, and a definition-list structure on monitor detail.

---

# Monitor-detail performance and Import from GitHub (30 Oct)

Memory kept at or below 80 % (a second Claude session runs beside this one). Heavy processes (Chrome, Lighthouse, dev servers) ran one at a time under a lock.

- [x] **Monitor detail performance** (`c9773bc`): the chart sections load as their own chunks (the page chunk went from 448 KB to 25 KB) and
      the ones below the fold render only when near the viewport (`LazyOnView`). Lighthouse, mobile, signed in: performance **60 → 83**
      (blocking time 1.39 s → 0.42 s, main content 4.4 s → 3.3 s), accessibility 97 → 100. Still 2 points under the 85 target; next
      candidates are the sparkline cards above the fold and the shared chart chunk (364 KB).
- [x] **Import from GitHub, backend** (`0dc1fee`): `GET /workspaces/:wid/github/candidates` and `POST .../github/import`, pure extraction and
      ranking in `packages/shared/src/github`, the GitHub token stored AES-256-GCM encrypted on the identity (sign-in scopes unchanged),
      `finalUrl` added to check results, docs in API.md and D106. 30 + 29 new tests.
- [x] **Import from GitHub, frontend** (`fee8391`): review screen at `/app/:wid/import/github`, entry points on the dashboard, helpers with 17 tests.
- [x] README: feature bullet, "Import from GitHub" section, `GITHUB_TOKEN_ENCRYPTION_KEY` in the env table.
- Gate: agent 49, shared 346, API 339, client 262, demo-target 23, worker 77 tests; ESLint, Prettier and both builds clean.
- [x] **Review screen checked in a browser** (dark and light, 1440 and 390 px, every API call mocked): dashboard button and empty state, loading,
      grouped list with source badges and Live / Redirect / Down labels, already-monitored row disabled, select all, the status-page option,
      the import request (monitored URL left out), result view, include forks, and the 409 / 429 (retry time read from `error.details.resetAt`) /
      502 / empty states; no page errors. Found and fixed one defect: on phones the sticky Import bar sat under the bottom navigation. Memory stayed under 80 %.
- [x] **Live check (30 Oct):** tried on the live site with a real GitHub sign-in against the real GitHub API; the owner confirmed it works.
- Known limits: users who signed in with GitHub before this feature have no stored token and are asked to sign in again; the 10-minute cache
  is per API process.

---

# Light theme: down regions in the signal field (30 Oct)

- [x] In light mode the field's down regions were dark ink at low opacity and barely stood out. They are now drawn bigger (up to 1.9x),
      fully red (not 85 %), with an opacity floor of 0.85 so even the faint far rows read as red, in a more vivid red (`--field-down`,
      light theme only). Same rules in the WebGL shader and the 2D fallback (`INK_DOWN` in `fieldMath.js`); the dark theme is unchanged.
      3 new tests, 265 client tests.
- [x] **Checked by the owner (30 Oct):** the red down regions are clearly visible in light mode.
