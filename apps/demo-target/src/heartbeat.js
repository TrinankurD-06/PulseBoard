// A pretend cron job for the Heartbeat monitor: signals /start, "works" for a
// moment, then pings (or reports /fail). Used by scripts/heartbeat-cron.js.

export const USAGE = `Usage: npm run heartbeat -w @pulseboard/demo-target -- [options]

  --every <sec>       seconds between runs (default 30)
  --fail              report each run as failed (/fail) instead of a success ping
  --stop-after <n>    stop after n runs (e.g. to show "pings stop -> incident")
  --help              show this help

The heartbeat URL comes from HEARTBEAT_URL, else apps/demo-target/.pulseboard-demo.json
(written by npm run seed).`;

/** Parses CLI flags. Throws an Error with a readable message on bad input. */
export function parseArgs(argv) {
  const options = { everySec: 30, fail: false, stopAfter: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const number = (name) => {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1)
        throw new Error(`${name} needs a whole number ≥ 1`);
      i += 1;
      return value;
    };
    if (arg === '--fail') options.fail = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--every') options.everySec = number('--every');
    else if (arg === '--stop-after') options.stopAfter = number('--stop-after');
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

/** The URLs one run calls: /start, then the ping or /fail?message=… */
export function runUrls(heartbeatUrl, { fail = false, message = 'Backup failed: disk full' } = {}) {
  const base = String(heartbeatUrl).replace(/\/+$/, '');
  return {
    start: `${base}/start`,
    finish: fail ? `${base}/fail?message=${encodeURIComponent(message)}` : base,
  };
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the pretend job every `everySec` until `stopAfter` runs (or forever).
 * Network errors are logged and the next run goes ahead, like a real cron.
 * Resolves with the number of runs.
 */
export async function runHeartbeat({
  heartbeatUrl,
  everySec = 30,
  fail = false,
  stopAfter = null,
  workMs = 1500,
  fetch: fetchImpl = globalThis.fetch,
  sleep = sleepMs,
  log = console.warn,
  shouldStop = () => false,
}) {
  const urls = runUrls(heartbeatUrl, { fail });
  const call = async (url) => {
    try {
      const res = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
      return res.ok ? 'ok' : `HTTP ${res.status}`;
    } catch (err) {
      return `error (${err?.cause?.code ?? err?.message ?? err})`;
    }
  };

  let runs = 0;
  while (!shouldStop()) {
    runs += 1;
    const started = await call(urls.start);
    await sleep(workMs);
    const finished = await call(urls.finish);
    log(
      `${new Date().toLocaleTimeString()} run ${runs}: start ${started}, ${fail ? 'fail' : 'ping'} ${finished}`,
    );
    if (stopAfter != null && runs >= stopAfter) break;
    await sleep(everySec * 1000);
  }
  return runs;
}
