import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_COOKIE = 'pb_oauth';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_NEXT = '/app';

const MAX_NEXT_LENGTH = 512;

const random = () => randomBytes(32).toString('base64url');

/** PKCE: a random verifier and its S256 challenge. */
export function createPkce() {
  const codeVerifier = random();
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export const createState = random;

/**
 * Where to send the user after sign-in. Only a same-origin relative path is
 * accepted ("/app/monitors?x=1"); anything that could leave the site
 * ("//evil.com", "/\evil.com", "https://...", control characters) becomes /app.
 */
export function sanitizeNext(next) {
  if (typeof next !== 'string' || !next || next.length > MAX_NEXT_LENGTH) return DEFAULT_NEXT;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return DEFAULT_NEXT;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_NEXT;
  // Belt and braces: resolving against a dummy origin must keep that origin.
  const base = 'http://pulseboard.invalid';
  try {
    if (new URL(next, base).origin !== base) return DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
  return next;
}

/** Equal-time string comparison (hashing first makes the lengths equal). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * The in-flight sign-in (state, PKCE verifier, provider, next) lives in a
 * short-lived cookie, HMAC-signed so it can't be forged or edited. No database
 * write is needed for a sign-in the user may abandon.
 */
export function createStateCookieCodec(secret) {
  // A key of its own, derived from the refresh secret, so the two never overlap.
  const key = createHmac('sha256', secret).update('pulseboard-oauth-state-v1').digest();
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url');

  return {
    encode({ provider, state, codeVerifier, next }, now = Date.now()) {
      const payload = Buffer.from(
        JSON.stringify({
          p: provider,
          s: state,
          v: codeVerifier,
          n: next,
          e: now + OAUTH_STATE_TTL_MS,
        }),
      ).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },

    /** Returns { provider, state, codeVerifier, next } or null if missing, forged or expired. */
    decode(cookie, now = Date.now()) {
      if (typeof cookie !== 'string') return null;
      const [payload, signature, extra] = cookie.split('.');
      if (!payload || !signature || extra !== undefined) return null;
      if (!safeEqual(signature, sign(payload))) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof data.e !== 'number' || data.e < now) return null;
        return {
          provider: data.p,
          state: data.s,
          codeVerifier: data.v,
          next: sanitizeNext(data.n),
        };
      } catch {
        return null;
      }
    },
  };
}
