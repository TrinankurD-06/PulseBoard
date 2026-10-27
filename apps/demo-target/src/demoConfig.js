import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Written by `npm run seed` (git-ignored): the demo agent key and heartbeat URL.
export const DEMO_FILE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.pulseboard-demo.json',
);

// The shortest window the agent allows. Reporting more often than the monitor
// expects is harmless; less often would look like silence, so when nothing
// says otherwise the demo reports every 30s.
const DEFAULT_REPORT_EVERY_SEC = 30;

/** The seed file's contents, or null when it is missing or unreadable. */
export function readDemoFile(filePath = DEMO_FILE_PATH, readFile = readFileSync) {
  try {
    const parsed = JSON.parse(readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Agent settings: env `PULSEBOARD_AGENT_KEY` + `PULSEBOARD_ENDPOINT` first,
 * else the seed file. Null when there is no key: the demo-target then runs
 * without an agent, exactly as before.
 */
export function loadAgentConfig({ env = process.env, file = readDemoFile() } = {}) {
  const fromEnv = env.PULSEBOARD_AGENT_KEY && env.PULSEBOARD_ENDPOINT;
  const source = fromEnv ? 'env' : file?.agentKey && file?.endpoint ? 'file' : null;
  if (!source) return null;

  const reportEverySec =
    Number(env.PULSEBOARD_REPORT_EVERY_SEC) ||
    Number(file?.reportEverySec) ||
    DEFAULT_REPORT_EVERY_SEC;
  return {
    apiKey: fromEnv ? env.PULSEBOARD_AGENT_KEY : file.agentKey,
    endpoint: fromEnv ? env.PULSEBOARD_ENDPOINT : file.endpoint,
    reportEverySec,
    source,
  };
}

/** The heartbeat URL for scripts/heartbeat-cron.js: env `HEARTBEAT_URL`, else the seed file. */
export function loadHeartbeatUrl({ env = process.env, file = readDemoFile() } = {}) {
  return env.HEARTBEAT_URL || file?.heartbeatUrl || null;
}
