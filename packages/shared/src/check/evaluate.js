/**
 * Decides whether a finished HTTP exchange counts as "up". Pure function, so
 * every rule is unit-testable without a network.
 *
 * A check is ok only if: there was no network error, the status code is in the
 * expected range, and (if a keyword is set) the body contains it.
 */
export function evaluateCheck({ statusCode, body, error }, { expectedStatus, keyword }) {
  if (error) return { ok: false, error };

  if (statusCode < expectedStatus.min || statusCode > expectedStatus.max) {
    return {
      ok: false,
      error: `Unexpected status ${statusCode} (expected ${expectedStatus.min}–${expectedStatus.max})`,
    };
  }

  // Case-sensitive on purpose: "OK" and "ok" may mean different things to an API.
  if (keyword && !(body ?? '').includes(keyword)) {
    return { ok: false, error: `Keyword "${keyword}" not found in response` };
  }

  return { ok: true, error: null };
}
