import express from 'express';

// The demo-target pretends to be a customer's website. Switching its mode
// during a live demo shows PulseBoard detecting outages in real time.
export const MODES = {
  up: 'Healthy: 200 OK with the "healthy" keyword',
  down: 'Unreachable: the connection is dropped',
  slow: 'Slow: 200 OK, but after a ~3s delay',
  error500: 'Broken: responds 500 Internal Server Error',
  'missing-keyword': 'Degraded: 200 OK, but the "healthy" keyword is missing',
};

const SLOW_DELAY_MS = 3000;

export function createDemoTargetApp({ initialMode = 'up' } = {}) {
  const app = express();
  let mode = initialMode;
  let changedAt = new Date();

  app.use(express.json({ limit: '1kb' }));

  app.get('/', (req, res) => {
    switch (mode) {
      case 'down':
        // Like a crashed server: no HTTP response at all.
        req.socket.destroy();
        return;
      case 'slow':
        setTimeout(() => res.type('text').send('status: healthy (slowly)'), SLOW_DELAY_MS);
        return;
      case 'error500':
        res.status(500).type('text').send('Internal Server Error');
        return;
      case 'missing-keyword':
        res.type('text').send('status: degraded');
        return;
      default:
        res.type('text').send('status: healthy');
    }
  });

  app.get('/admin/mode', (_req, res) => res.json({ mode, changedAt }));

  app.post('/admin/mode', (req, res) => {
    const next = req.body?.mode;
    if (!Object.hasOwn(MODES, next)) {
      res.status(400).json({ error: `mode must be one of: ${Object.keys(MODES).join(', ')}` });
      return;
    }
    mode = next;
    changedAt = new Date();
    res.json({ mode, changedAt });
  });

  app.get('/admin', (_req, res) => res.type('html').send(renderControlPage()));

  return app;
}

function renderControlPage() {
  const buttons = Object.entries(MODES)
    .map(
      ([mode, description]) => `
      <button data-mode="${mode}">
        <strong>${mode}</strong><span>${description}</span>
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
    main { width: min(560px, calc(100% - 32px)); }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    p { color: #94a3b8; margin-top: 0; }
    .current { margin: 20px 0; padding: 14px 16px; border-radius: 10px; background: #0f172a; border: 1px solid #1e293b; }
    .current b { color: #22c55e; font-size: 1.1rem; }
    .current.bad b { color: #ef4444; }
    button { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; margin-bottom: 10px;
      padding: 12px 16px; border-radius: 10px; border: 1px solid #1e293b; background: #0f172a; color: inherit;
      font: inherit; cursor: pointer; }
    button:hover { border-color: #22c55e; }
    button.active { border-color: #22c55e; background: #052e1a; }
    button span { color: #94a3b8; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main>
    <h1>Demo target</h1>
    <p>Switch how <code>GET /</code> behaves. PulseBoard's monitor will notice within a few checks.</p>
    <div class="current" id="current">Current mode: <b id="mode">…</b></div>
    ${buttons}
  </main>
  <script>
    const show = ({ mode }) => {
      document.getElementById('mode').textContent = mode;
      document.getElementById('current').classList.toggle('bad', mode !== 'up');
      document.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    };
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', async () => {
        const res = await fetch('/admin/mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: button.dataset.mode }),
        });
        show(await res.json());
      });
    });
    fetch('/admin/mode').then((res) => res.json()).then(show);
  </script>
</body>
</html>`;
}
