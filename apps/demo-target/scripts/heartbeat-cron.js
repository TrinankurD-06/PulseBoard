// Pretend cron job for the "Nightly backup" Heartbeat monitor. Not started by
// `npm run dev`: run it by hand during a demo, then stop it (Ctrl+C or
// --stop-after) to show "pings stop -> incident".
import { loadHeartbeatUrl } from '../src/demoConfig.js';
import { parseArgs, runHeartbeat, USAGE } from '../src/heartbeat.js';

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`${err.message}\n\n${USAGE}`);
  process.exit(1);
}
if (options.help) {
  console.warn(USAGE);
  process.exit(0);
}

const heartbeatUrl = loadHeartbeatUrl();
if (!heartbeatUrl) {
  console.error(`No heartbeat URL: set HEARTBEAT_URL or run "npm run seed" first.\n\n${USAGE}`);
  process.exit(1);
}

console.warn(
  `Pinging ${heartbeatUrl.replace(/[^/]+$/, '••••••••')} every ${options.everySec}s` +
    (options.fail ? ' (reporting failures)' : '') +
    (options.stopAfter ? `, stopping after ${options.stopAfter} runs` : ', Ctrl+C to stop'),
);

let stopping = false;
process.once('SIGINT', () => {
  stopping = true;
  process.exit(0);
});

const runs = await runHeartbeat({ ...options, heartbeatUrl, shouldStop: () => stopping });
console.warn(`Stopped after ${runs} run${runs === 1 ? '' : 's'}: no more pings will arrive.`);
