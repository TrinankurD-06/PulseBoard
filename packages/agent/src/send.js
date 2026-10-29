import os from 'node:os';
import { AGENT_VERSION, REQUEST_TIMEOUT_MS } from './options.js';

/** The fields every report carries besides the window's numbers. */
export function reportExtras(serviceName) {
  const extras = {
    agentVersion: AGENT_VERSION,
    hostname: os.hostname(),
    uptimeSec: Math.round(process.uptime()),
  };
  if (serviceName) extras.serviceName = serviceName;
  return extras;
}

/**
 * POSTs one report. Resolves `{ ok: true }` or `{ ok: false, reason }`; never
 * rejects, so callers can't leak an error into the host app.
 */
export async function postReport({
  url,
  apiKey,
  body,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': `pulseboard-agent/${AGENT_VERSION}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `PulseBoard answered HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `could not reach PulseBoard (${err?.message ?? err})` };
  }
}
