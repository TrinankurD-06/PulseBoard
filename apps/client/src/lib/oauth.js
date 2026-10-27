// Pure helpers for "Continue with Google/GitHub". The server sends the browser
// back to /auth/callback with ?status=ok&next=… or ?status=error&code=….

/**
 * `next` if it's a path inside this app ("/app/123"), otherwise `fallback`.
 * Rejects absolute URLs and protocol-relative ones ("//evil.com", "/\evil.com":
 * browsers treat a backslash like a slash), so the callback can't be used as an
 * open redirect.
 */
export function safeNextPath(next, fallback = '/app') {
  if (typeof next !== 'string' || !next.startsWith('/')) return fallback;
  if (next.startsWith('//') || next.includes('\\')) return fallback;
  // Control characters (tabs, newlines) are stripped by URL parsers: "/\t/evil.com".
  if ([...next].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return fallback;
  }
  return next;
}

export const OAUTH_ERROR_MESSAGES = {
  OAUTH_DENIED: 'Sign-in was cancelled. Try again, or log in with your email and password.',
  OAUTH_STATE_INVALID: 'That sign-in attempt expired or was already used. Please try again.',
  OAUTH_EMAIL_UNVERIFIED:
    'That account has no verified email address. Verify it with the provider first, or use your email and password.',
  OAUTH_PROVIDER_ERROR: "We couldn't complete sign-in with the provider. Please try again.",
  OAUTH_NOT_CONFIGURED: "That sign-in option isn't available right now.",
  RATE_LIMITED: 'Too many sign-in attempts. Please try again in a few minutes.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
};

/** Friendly text for an error code from the callback; a generic line for unknown codes. */
export function oauthErrorMessage(code) {
  return OAUTH_ERROR_MESSAGES[code] ?? "Sign-in didn't complete. Please try again.";
}
