import express from 'express';
import { createAgentController } from './agentController.js';

// The demo-target pretends to be a customer's website. Switching its mode
// during a live demo shows PulseBoard detecting outages in real time.
export const MODES = {
  up: 'Healthy: 200 OK with the "healthy" keyword',
  down: 'Unreachable: the connection is dropped',
  slow: 'Slow: 200 OK, but after a ~3s delay',
  error500: 'Broken: responds 500 Internal Server Error',
  'missing-keyword': 'Degraded: 200 OK, but the "healthy" keyword is missing',
};

// One-click demo scenarios for the app agent (pulseboard-agent).
export const SCENARIOS = {
  crash: 'Crash: the agent stops and the site drops every connection → probes fail → incident',
  'agent-silent': 'Agent silent: the agent stops, the site keeps serving → degraded, no incident',
  errors: '5xx errors: every page answers 500 → error-rate incident (agent and HTTP monitor)',
  restore: 'Restore: the site is healthy and a fresh agent instance reports again',
};

const SLOW_DELAY_MS = 3000;

const PRODUCTS = [
  { id: 1, name: 'Espresso beans', price: 499 },
  { id: 2, name: 'Pour-over kettle', price: 2899 },
  { id: 3, name: 'Paper filters', price: 199 },
];

/**
 * `agent`: an agent controller (see agentController.js); without one the
 * site runs with no agent. `traffic`: { everyMs } when background traffic
 * runs, shown on the control page.
 */
export function createDemoTargetApp({
  initialMode = 'up',
  agent = createAgentController(),
  traffic = null,
} = {}) {
  const app = express();
  let mode = initialMode;
  let changedAt = new Date();

  const setMode = (next) => {
    mode = next;
    changedAt = new Date();
  };
  const state = () => ({ mode, changedAt, agent: agent.status(), traffic });

  // Admin routes come first, so the agent never measures the control page.
  const admin = express.Router();
  admin.use(express.json({ limit: '1kb' }));

  admin.get('/mode', (_req, res) => res.json({ mode, changedAt }));

  admin.post('/mode', (req, res) => {
    const next = req.body?.mode;
    if (!Object.hasOwn(MODES, next)) {
      res.status(400).json({ error: `mode must be one of: ${Object.keys(MODES).join(', ')}` });
      return;
    }
    setMode(next);
    res.json({ mode, changedAt });
  });

  admin.get('/state', (_req, res) => res.json(state()));

  admin.post('/scenario', async (req, res) => {
    const scenario = req.body?.scenario;
    switch (scenario) {
      case 'crash':
        setMode('down');
        await agent.stop();
        break;
      case 'agent-silent':
        // The site must answer 2xx, or probes would count it as down.
        setMode('up');
        await agent.stop();
        break;
      case 'errors':
        setMode('error500');
        agent.start();
        break;
      case 'restore':
        setMode('up');
        await agent.restart();
        break;
      default:
        res.status(400).json({
          error: `scenario must be one of: ${Object.keys(SCENARIOS).join(', ')}`,
        });
        return;
    }
    res.json(state());
  });

  admin.get('/', (_req, res) => res.type('html').send(renderControlPage()));
  app.use('/admin', admin);

  app.use(agent.middleware);

  // Applies the failure modes to every site route. Returns true when the
  // response was handled. Inside the route handler, so the agent still sees
  // the route pattern (e.g. /api/orders/:id) for failed requests.
  const failed = (req, res) => {
    if (mode === 'down') {
      // Like a crashed server: no HTTP response at all.
      req.socket.destroy();
      return true;
    }
    if (mode === 'error500') {
      res.status(500).type('text').send('Internal Server Error');
      return true;
    }
    return false;
  };
  const respond = (req, res, send) => {
    if (failed(req, res)) return;
    if (mode === 'slow') setTimeout(send, SLOW_DELAY_MS);
    else send();
  };

  app.get('/', (req, res) =>
    respond(req, res, () => {
      if (mode === 'missing-keyword') res.type('text').send('status: degraded');
      else if (mode === 'slow') res.type('text').send('status: healthy (slowly)');
      else res.type('text').send('status: healthy');
    }),
  );

  app.get('/api/products', (req, res) => respond(req, res, () => res.json(PRODUCTS)));

  app.get('/api/orders/:id', (req, res) =>
    respond(req, res, () => {
      if (!/^\d+$/.test(req.params.id)) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      res.json({ id: Number(req.params.id), status: 'shipped', items: 2 });
    }),
  );

  return app;
}

function renderControlPage() {
  const buttons = (entries, attr) =>
    entries
      .map(
        ([value, description]) => `
      <button type="button" ${attr}="${value}">
        <strong>${value}</strong><span>${description}</span>
      </button>`,
      )
      .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo target control</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #020617; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; }
    main { width: min(560px, calc(100% - 32px)); padding: 24px 0; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    h2 { font-size: 1.05rem; margin: 28px 0 4px; }
    p { color: #94a3b8; margin-top: 0; }
    .current { margin: 16px 0; padding: 14px 16px; border-radius: 10px; background: #0f172a; border: 1px solid #1e293b; }
    .current p { margin: 4px 0 0; font-size: 0.9rem; }
    .current b { color: #22c55e; font-size: 1.1rem; }
    .current.bad b { color: #ef4444; }
    button { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; margin-bottom: 10px;
      padding: 12px 16px; border-radius: 10px; border: 1px solid #1e293b; background: #0f172a; color: inherit;
      font: inherit; cursor: pointer; }
    button:hover { border-color: #22c55e; }
    button:focus-visible { outline: 2px solid #22c55e; outline-offset: 2px; }
    button.active { border-color: #22c55e; background: #052e1a; }
    button span { color: #94a3b8; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main>
    <h1>Demo target</h1>
    <p>A pretend customer site with <code>/</code>, <code>/api/products</code> and <code>/api/orders/:id</code>.</p>
    <div class="current" id="current" aria-live="polite">
      Site mode: <b id="mode">…</b>
      <p id="agent">Agent: …</p>
      <p id="traffic"></p>
    </div>

    <h2>Agent scenarios</h2>
    <p>For the "App agent" monitor (pulseboard-agent inside this site).</p>
    ${buttons(Object.entries(SCENARIOS), 'data-scenario')}

    <h2>Site mode</h2>
    <p>Switch how the site's pages behave. PulseBoard's HTTP monitor will notice within a few checks.</p>
    ${buttons(Object.entries(MODES), 'data-mode')}
  </main>
  <script>
    const time = (value) => new Date(value).toLocaleTimeString();
    const agentText = (agent) => {
      if (!agent || agent.state === 'off') {
        return 'Agent: not configured. Run "npm run seed" (or set PULSEBOARD_AGENT_KEY and PULSEBOARD_ENDPOINT) and restart the demo target.';
      }
      if (agent.state === 'reporting') {
        return 'Agent: reporting every ' + agent.reportEverySec + 's to ' + agent.endpoint + ' (since ' + time(agent.since) + ')';
      }
      return 'Agent: stopped since ' + time(agent.since) + ', no reports are sent';
    };
    const show = (state) => {
      document.getElementById('mode').textContent = state.mode;
      document.getElementById('current').classList.toggle('bad', state.mode !== 'up');
      document.querySelectorAll('[data-mode]').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === state.mode);
        b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
      });
      if (state.agent) document.getElementById('agent').textContent = agentText(state.agent);
      if ('traffic' in state) {
        document.getElementById('traffic').textContent = state.traffic
          ? 'Background traffic: about ' + Math.round(1000 / state.traffic.everyMs) + ' request/second to this site, so the agent charts move on their own.'
          : 'Background traffic: off.';
      }
    };
    const post = async (path, body) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    };
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', async () => {
        await post('/admin/mode', { mode: button.dataset.mode });
        show(await (await fetch('/admin/state')).json());
      });
    });
    document.querySelectorAll('[data-scenario]').forEach((button) => {
      button.addEventListener('click', async () => show(await post('/admin/scenario', { scenario: button.dataset.scenario })));
    });
    const refresh = () => fetch('/admin/state').then((res) => res.json()).then(show).catch(() => {});
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}
