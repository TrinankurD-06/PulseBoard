import { createAgentController } from './agentController.js';
import { createDemoTargetApp } from './app.js';
import { loadAgentConfig } from './demoConfig.js';
import { startBackgroundTraffic } from './traffic.js';

// Render sets PORT; locally DEMO_TARGET_PORT is used. The default is 4011, not
// 4001: VS Code's local server often holds 4001 (see DECISIONS.md).
const port = Number(process.env.PORT || process.env.DEMO_TARGET_PORT || 4011);

// The app agent reports when a key is available (env, or the file written by
// `npm run seed`); without one the site runs exactly as before.
const agentConfig = loadAgentConfig();
const agent = createAgentController({ config: agentConfig });
const trafficOn = process.env.DEMO_TRAFFIC !== 'off';
let traffic = null;

const app = createDemoTargetApp({ agent, traffic: trafficOn ? { everyMs: 1000 } : null });

const server = app.listen(port, () => {
  console.warn(`Demo target on http://localhost:${port} (control page: /admin)`);
  console.warn(
    agentConfig
      ? `App agent reporting every ${agentConfig.reportEverySec}s to ${agentConfig.endpoint} (key from ${agentConfig.source})`
      : 'App agent off: run "npm run seed" or set PULSEBOARD_AGENT_KEY and PULSEBOARD_ENDPOINT',
  );
  if (trafficOn) traffic = startBackgroundTraffic({ baseUrl: `http://localhost:${port}` });
});

// `npm run seed` may (re)write the key file while the demo-target runs: pick
// up a new or changed key without a restart. Env keys never change.
const sameKey = (a, b) => a?.apiKey === b?.apiKey && a?.endpoint === b?.endpoint;
let currentConfig = agentConfig;
const keyWatcher = setInterval(() => {
  if (currentConfig?.source === 'env') return;
  const next = loadAgentConfig();
  if (!next || sameKey(next, currentConfig)) return;
  console.warn(
    `App agent key ${currentConfig ? 'changed' : 'found'}: reporting to ${next.endpoint}`,
  );
  currentConfig = next;
  void agent.configure(next);
}, 5000);
keyWatcher.unref();

server.on('error', (err) => {
  console.error(`Demo target could not start on port ${port}: ${err.message}`);
  process.exit(1);
});

process.once('SIGINT', () => {
  traffic?.stop();
  server.close();
  void agent.stop().finally(() => process.exit(0));
});
