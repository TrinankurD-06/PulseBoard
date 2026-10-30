# Demo walkthrough

A guided tour of PulseBoard for a live demo or a screen recording. It starts with the classic part
(uptime checks, a live outage, an incident and its alerts) and ends with the push-first part
(agent, heartbeat, cost and usage). The first part takes about 5 minutes, the second about 5 more.

Everything here runs against the demo account and the demo target, a tiny site you can switch to
up, down, slow or 500 from its own control page. The demo account is read-only when the public demo
runs with `DEMO_READ_ONLY=true`: you can look at everything, and breaking and fixing the site is
done on the demo target's `/admin` page, which needs no login.

## Before you start

- [ ] **Wake the Render service** a minute or two early: open `https://<your-api>.onrender.com/health`
      until it answers. The free plan sleeps after about 15 minutes, and no checks run while it is
      asleep.
- [ ] **Wake the demo target** the same way: open its `/admin` page a minute before you begin, and make
      sure it is set to **up**.
- [ ] **Log in as the demo user** (`demo@pulseboard.dev` / `demo1234`; the login page has a "Fill in"
      button) and check the dashboard shows live data and the **Live** indicator.
- [ ] **Open a private window** on `/status/acme` ready for step 6.
- [ ] Have an alert channel you can see (Discord, Slack or the Resend inbox) in view for steps 4 and 7.
- [ ] Locally: `npm run seed` then `npm run dev`, and `npm run heartbeat -w @pulseboard/demo-target` in
      a second terminal for the heartbeat step.

## The walkthrough (about 5 minutes)

1. **Landing → login.** Open the site, show the pitch, log in as the demo user ("Fill in").
2. **Dashboard.** Four monitors with live sparklines; point at the **Live** indicator. Explain:
   the worker writes to MongoDB, change streams push to the browser.
3. **Monitor detail** (Demo API). Uptime tiles, response-time chart (switch 1h/24h/7d),
   timing breakdown, 90-day bars (hover a day), the Table view toggle. Press **Test now** (it needs an owner or member account, so skip it
   in the read-only public demo).
4. **Break it.** Open the demo-target control page (`/admin`) and click **down**.
   Back on the dashboard: within ~30 s (3 failed checks at 10 s) the card turns **red**, a
   "… is down" toast appears, and the Email (Resend), Discord or Slack alert arrives.
5. **Incidents page.** Expand the open incident's timeline (opened → alert sent).
6. **Public status page.** Open `/status/acme` in a private window: banner shows the outage,
   no login needed.
7. **Fix it.** Click **up** on the demo target. After 2 successful checks (~20 s) the incident
   resolves with the correct duration, and a recovery alert is sent.
8. **(Optional) under the hood.** `/health` on API and worker; run two workers to show checks
   aren't duplicated (Agenda locking); `docs/DECISIONS.md` for the reasoning.

## The push-first part (about 5 more minutes)

9. **Agent.** Open **Demo Agent**: live request rate, error rate and latency from the
   demo-target's own traffic. Point at "requests saved vs 1-minute polling".
10. **Errors.** On `/admin`, switch on **5xx errors**: the error-rate chart jumps and after 3
    report windows (~1.5 min) an incident opens with "Error rate … above 5 %". Switch it off.
11. **Agent silent.** Click **agent silent**: the site keeps serving, so after ~1 min the probes
    succeed and the monitor turns amber **Degraded** with one notice, no incident.
12. **Crash.** Click **crash**: no reports, probes refused, and within ~2 minutes an incident
    opens and the alert arrives. Click **restore**: the next reports resolve it.
13. **Heartbeat.** Run `npm run heartbeat -w @pulseboard/demo-target -- --stop-after 3`: three
    pings, then silence; **Demo Cron Job** opens an incident once the expected period + grace
    has passed. Start the script again and the first ping resolves it. `--fail` reports a
    failure with a message.
14. **Cost & usage.** Requests sent this month, requests saved, the estimate and cost per
    currency, per-monitor intervals (adaptive / slowed) and budget bars.
15. **Admin panel.** Sign in with the evaluation admin from the README (Admin panel section) and open
    **Admin**: every user, the demo account included, with workspaces and monitor counts. Press **Stop
    monitors** on a user (confirm), watch their monitors turn paused on that user's dashboard, then press
    **Start monitors**. A user cannot resume what you stopped.

Tip: in production the free demo-target sleeps when idle; open its `/admin` page a minute
before the demo.
