import { createDemoTargetApp } from './app.js';

// Render sets PORT; locally DEMO_TARGET_PORT is used. The default is 4011, not
// 4001: VS Code's local server often holds 4001 (see DECISIONS.md).
const port = Number(process.env.PORT || process.env.DEMO_TARGET_PORT || 4011);

const server = createDemoTargetApp().listen(port, () => {
  console.warn(`Demo target on http://localhost:${port} (control page: /admin)`);
});

server.on('error', (err) => {
  console.error(`Demo target could not start on port ${port}: ${err.message}`);
  process.exit(1);
});
