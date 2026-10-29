import { AppError } from '../../lib/errors.js';

const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
// Stop before the very last request so the user's other GitHub tools keep working.
const RATE_LIMIT_RESERVE = 2;

const notLinked = (message) => new AppError(409, 'GITHUB_NOT_LINKED', message);
const unavailable = (message) => new AppError(502, 'GITHUB_UNAVAILABLE', message);
const rateLimited = (resetAt) =>
  new AppError(
    429,
    'GITHUB_RATE_LIMITED',
    'GitHub rate limit reached. Try again after the limit resets.',
    { resetAt: resetAt ? resetAt.toISOString() : null },
  );

/**
 * A small read-only GitHub REST client for one access token. `fetch` is a
 * parameter so tests never touch the network. It reads X-RateLimit-Remaining
 * and X-RateLimit-Reset from every answer and refuses to send further requests
 * once the allowance is used up (throws GITHUB_RATE_LIMITED with `resetAt`).
 * The token only lives in this closure: it is never logged or put in errors.
 */
export function createGithubClient({ fetch: fetchImpl = globalThis.fetch, token, now = Date.now }) {
  let rateLimit = null; // { remaining, resetAt: Date }

  function readRateLimit(headers) {
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (headers.get('x-ratelimit-remaining') !== null && Number.isFinite(remaining)) {
      rateLimit = {
        remaining,
        resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null,
      };
    }
  }

  /**
   * GET one path. Returns { data, hasNext }, or null for an optional resource
   * that is missing or unreadable (404, 409 empty repo, 451, other 4xx/5xx).
   * Without `optional`, those become GITHUB_UNAVAILABLE. Rate limits and a
   * rejected token always throw.
   */
  async function request(path, { raw = false, optional = false } = {}) {
    if (
      rateLimit &&
      rateLimit.remaining <= RATE_LIMIT_RESERVE &&
      (!rateLimit.resetAt || rateLimit.resetAt.getTime() > now())
    ) {
      throw rateLimited(rateLimit.resetAt);
    }

    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'User-Agent': 'PulseBoard',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      if (optional) return null;
      throw unavailable('Could not reach GitHub');
    }
    readRateLimit(res.headers);

    if (res.status === 401) {
      throw notLinked('GitHub no longer accepts your saved sign-in. Sign in with GitHub again.');
    }
    if (
      res.status === 429 ||
      (res.status === 403 &&
        (rateLimit?.remaining === 0 || res.headers.get('retry-after') !== null))
    ) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const resetAt =
        rateLimit?.resetAt ??
        (Number.isFinite(retryAfter) && retryAfter > 0
          ? new Date(now() + retryAfter * 1000)
          : null);
      rateLimit = { remaining: 0, resetAt };
      throw rateLimited(resetAt);
    }
    if (!res.ok) {
      if (optional) return null;
      throw unavailable(`GitHub answered ${res.status}`);
    }

    try {
      const data = raw ? await res.text() : await res.json();
      return { data, hasNext: /rel="next"/.test(res.headers.get('link') ?? '') };
    } catch {
      if (optional) return null;
      throw unavailable('GitHub returned an unreadable answer');
    }
  }

  return {
    request,
    /** { remaining, resetAt: ISO string } from the last answer, or null if none was seen. */
    get rateLimit() {
      return rateLimit
        ? { remaining: rateLimit.remaining, resetAt: rateLimit.resetAt?.toISOString() ?? null }
        : null;
    },
  };
}
