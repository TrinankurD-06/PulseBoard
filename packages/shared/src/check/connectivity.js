// Is the checker itself online? When a check fails with a network error, the
// fault may be ours (no internet), not the customer's. Before counting such a
// failure we probe fixed reference hosts; only when ALL of them fail is the
// result "unknown" (checker offline) instead of "failed".
import {
  CHECK_STATE,
  NETWORK_ERROR_CODES,
  REFERENCE_HOSTS,
  UNKNOWN_REASONS,
} from '../constants.js';

/**
 * One HEAD request to a fixed host. Any HTTP answer, whatever its status, means
 * the network works; a rejection (DNS, connect, timeout) means it did not.
 * Not the SSRF-guarded customer path: these hosts are ours.
 */
async function headRequest(host, { timeoutMs }) {
  const response = await fetch(host, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { statusCode: response.status };
}

/**
 * Probes the reference hosts in parallel. `request(host, { timeoutMs })` is
 * injectable for tests: resolve = reachable, reject = not.
 *
 * @returns { online, results: [{ host, ok }] }; offline only when every host fails.
 */
export async function probeReferenceHosts({
  hosts = REFERENCE_HOSTS,
  timeoutMs = 5000,
  request = headRequest,
} = {}) {
  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        await request(host, { timeoutMs });
        return { host, ok: true };
      } catch {
        return { host, ok: false };
      }
    }),
  );
  return { online: results.some((r) => r.ok), results };
}

/**
 * Stamps a check result with its `state`. Successes are 'ok'. A failure whose
 * errorCode is a network error is probed first: checker offline gives
 * 'unknown' (+ unknownReason), otherwise 'failed'. Every other failure (HTTP
 * status, keyword, refused connection, blocked target...) is 'failed' without
 * any probe: the checker's network demonstrably worked to produce it.
 *
 * `probe` is injectable (default: probeReferenceHosts) and returns { online }.
 */
export async function guardNetworkFailure(result, { probe = probeReferenceHosts } = {}) {
  if (result.ok) return { ...result, state: CHECK_STATE.OK };
  if (!NETWORK_ERROR_CODES.includes(result.errorCode)) {
    return { ...result, state: CHECK_STATE.FAILED };
  }
  const { online } = await probe();
  if (online) return { ...result, state: CHECK_STATE.FAILED };
  return {
    ...result,
    state: CHECK_STATE.UNKNOWN,
    unknownReason: UNKNOWN_REASONS.CHECKER_OFFLINE,
  };
}
