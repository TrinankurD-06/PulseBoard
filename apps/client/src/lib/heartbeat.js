// Pure helpers for heartbeat monitors (the customer's job pings us):
// form presets and validation, ping URL, copy-paste snippets, labels.
import { buildMonitorSchemas } from '@pulseboard/shared/schemas';
import { formatDuration, timeAgo } from './format.js';

export const HEARTBEAT_TYPE = 'heartbeat';
export const isHeartbeat = (monitor) => monitor?.type === HEARTBEAT_TYPE;

const DAY = 24 * 60 * 60;
export const DEFAULT_GRACE_SEC = 60;

// 10 s and 30 s only appear when the server allows them (DEMO_MODE minimum).
const EXPECTED_PRESETS = [10, 30, 60, 300, 900, 3600, 6 * 3600, DAY, 7 * DAY];
const GRACE_PRESETS = [0, 60, 300, 900, 3600];

/** Preset options, always including the current value so editing never loses it. */
export function expectedEveryOptions(minIntervalSec, current) {
  const presets = EXPECTED_PRESETS.filter((sec) => sec >= minIntervalSec);
  return withCurrent(presets, current);
}

export function graceOptions(current) {
  return withCurrent(GRACE_PRESETS, current);
}

function withCurrent(presets, current) {
  const value = Number(current);
  if (!Number.isFinite(value) || presets.includes(value)) return presets;
  return [...presets, value].sort((a, b) => a - b);
}

/**
 * Form schema for a heartbeat monitor: the API's own shared schema (minus
 * `type`, which the page adds), so client and server rules can't drift.
 * The server's minimum interval tells us whether it runs in DEMO_MODE.
 */
export function buildHeartbeatSchema(minIntervalSec) {
  const { heartbeatCreate } = buildMonitorSchemas({ demoMode: minIntervalSec < 30 });
  return heartbeatCreate.omit({ type: true });
}

/** The secret URL the customer's job calls. */
export function pingUrl(token, origin = globalThis.window?.location?.origin ?? '') {
  return `${origin}/api/v1/ping/${token}`;
}

/**
 * A cron schedule that matches the expected interval, for the copy-paste
 * snippet. Intervals that cron can't express exactly fall back to "every 5 min".
 */
export function cronFor(expectedEverySec) {
  const sec = Number(expectedEverySec);
  if (sec === 7 * DAY) return '0 0 * * 0';
  if (sec === DAY) return '0 0 * * *';
  if (sec >= 3600 && sec < DAY && sec % 3600 === 0 && 24 % (sec / 3600) === 0) {
    return sec === 3600 ? '0 * * * *' : `0 */${sec / 3600} * * *`;
  }
  if (sec >= 60 && sec < 3600 && sec % 60 === 0 && 60 % (sec / 60) === 0) {
    return sec === 60 ? '* * * * *' : `*/${sec / 60} * * * *`;
  }
  return '*/5 * * * *';
}

/** Copy-paste snippets for the setup card, keyed by tab. */
export function heartbeatSnippets(url, expectedEverySec) {
  return {
    curl: `curl -fsS -m 10 --retry 3 ${url}`,
    cron: `${cronFor(expectedEverySec)}  /path/to/your-job.sh && curl -fsS -m 10 --retry 3 ${url} > /dev/null`,
    node: [
      `// After your job finished successfully:`,
      `await fetch('${url}', { method: 'POST' }).catch(() => {});`,
    ].join('\n'),
    startFail: [
      `const PING = '${url}';`,
      ``,
      `await fetch(\`\${PING}/start\`).catch(() => {}); // optional: measures run duration`,
      `try {`,
      `  await runJob();`,
      `  await fetch(PING).catch(() => {}); // success`,
      `} catch (err) {`,
      `  // explicit failure: opens an incident right away`,
      `  await fetch(\`\${PING}/fail\`, {`,
      `    method: 'POST',`,
      `    headers: { 'content-type': 'application/json' },`,
      `    body: JSON.stringify({ message: err.message }),`,
      `  }).catch(() => {});`,
      `  throw err;`,
      `}`,
    ].join('\n'),
  };
}

export const SNIPPET_TABS = [
  { key: 'curl', label: 'curl' },
  { key: 'cron', label: 'Cron line' },
  { key: 'node', label: 'Node fetch' },
  { key: 'startFail', label: 'Start / fail' },
];

/** "every 1h · heartbeat" for dashboard cards. */
export function heartbeatIntervalLabel(monitor) {
  return `every ${formatDuration(monitor.expectedEverySec)} · heartbeat`;
}

/**
 * Where the monitor stands right now, as text (colour is only a reinforcement).
 * `state`: 'paused' | 'waiting' (never pinged) | 'overdue' | 'ok'.
 */
export function heartbeatState(monitor, now = Date.now()) {
  if (monitor.isPaused) return { state: 'paused', text: 'Paused: pings are ignored' };
  const due = monitor.nextDueAt ? new Date(monitor.nextDueAt).getTime() : null;
  if (!monitor.lastPingAt) {
    return due && now > due
      ? { state: 'overdue', text: `No ping yet: expected by ${formatTime(due)}` }
      : {
          state: 'waiting',
          text: due
            ? `Waiting for the first ping (by ${formatTime(due)})`
            : 'Waiting for the first ping',
        };
  }
  if (due && now > due) {
    return { state: 'overdue', text: `Overdue since ${formatTime(due)}` };
  }
  return {
    state: 'ok',
    text: due ? `Next ping expected by ${formatTime(due)}` : 'Receiving pings',
  };
}

export function lastPingLabel(monitor, now = Date.now()) {
  return monitor.lastPingAt ? timeAgo(monitor.lastPingAt, now) : 'never';
}

function formatTime(ms) {
  const date = new Date(ms);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Ping history from /checks?limit=N points: each ping or missed period with a
 * text label, and the average run duration of runs that used /start.
 */
export function pingHistory(points = []) {
  const entries = points.map((p) => ({
    t: p.t,
    ok: Boolean(p.ok),
    durationMs: p.totalMs ?? null,
    label: p.ok ? 'Ping received' : 'Missed or failed',
  }));
  const durations = entries.map((e) => e.durationMs).filter((ms) => ms != null);
  const avgDurationMs = durations.length
    ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
    : null;
  return {
    entries,
    received: entries.filter((e) => e.ok).length,
    missed: entries.filter((e) => !e.ok).length,
    avgDurationMs,
  };
}
