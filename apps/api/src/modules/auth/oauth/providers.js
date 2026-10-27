import { OAUTH_PROVIDERS } from '@pulseboard/shared/constants';

const TIMEOUT_MS = 10_000;

/**
 * A failure talking to the provider (network, non-2xx, malformed answer) or a
 * refused sign-in. `code` is what the browser is redirected with.
 */
export class OAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const providerError = (message) => new OAuthError('OAUTH_PROVIDER_ERROR', message);

async function getJson(fetchImpl, url, init) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw providerError(`Request to ${new URL(url).host} failed: ${err.message}`);
  }
  if (!res.ok) throw providerError(`${new URL(url).host} answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw providerError(`${new URL(url).host} returned invalid JSON`);
  }
}

const bearer = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

/**
 * Static description of each provider. Credentials come from env; everything
 * else is fixed by the provider. fetchProfile normalises the provider's user
 * info to { providerId, email, emailVerified, name }.
 */
export const PROVIDERS = {
  google: {
    id: 'google',
    name: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
    extraAuthorizeParams: { prompt: 'select_account' },
    async fetchProfile(accessToken, fetchImpl) {
      const info = await getJson(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', {
        headers: bearer(accessToken),
      });
      if (!info?.sub) throw providerError('Google userinfo has no subject');
      return {
        providerId: String(info.sub),
        email: info.email ? String(info.email).toLowerCase() : null,
        emailVerified: info.email_verified === true || info.email_verified === 'true',
        name: info.name || null,
      };
    },
  },

  github: {
    id: 'github',
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
    extraAuthorizeParams: {},
    async fetchProfile(accessToken, fetchImpl) {
      // GitHub's API rejects requests without a User-Agent.
      const headers = {
        ...bearer(accessToken),
        Accept: 'application/vnd.github+json',
        'User-Agent': 'PulseBoard',
      };
      const user = await getJson(fetchImpl, 'https://api.github.com/user', { headers });
      if (user?.id === undefined || user?.id === null) throw providerError('GitHub user has no id');
      const emails = await getJson(fetchImpl, 'https://api.github.com/user/emails', { headers });
      // Only the primary address, and only if GitHub has verified it.
      const primary = Array.isArray(emails) ? emails.find((entry) => entry?.primary) : null;
      return {
        providerId: String(user.id),
        email: primary?.email ? String(primary.email).toLowerCase() : null,
        emailVerified: primary?.verified === true,
        name: user.name || user.login || null,
      };
    },
  },
};

/** The providers whose client id and secret are both configured, in a stable order. */
export function enabledProviders(env) {
  return OAUTH_PROVIDERS.filter((id) => {
    const prefix = id.toUpperCase();
    return Boolean(env[`${prefix}_CLIENT_ID`] && env[`${prefix}_CLIENT_SECRET`]);
  }).map((id) => ({
    ...PROVIDERS[id],
    clientId: env[`${id.toUpperCase()}_CLIENT_ID`],
    clientSecret: env[`${id.toUpperCase()}_CLIENT_SECRET`],
  }));
}

/** The URL the browser is sent to so the user can approve sign-in. */
export function buildAuthorizeUrl(provider, { redirectUri, state, codeChallenge }) {
  const url = new URL(provider.authorizeUrl);
  const params = {
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthorizeParams,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Exchanges the authorization code (plus the PKCE verifier) for an access token. */
export async function exchangeCode(provider, { code, codeVerifier, redirectUri }, fetchImpl) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code_verifier: codeVerifier,
  });
  const token = await getJson(fetchImpl, provider.tokenUrl, {
    method: 'POST',
    // GitHub answers form-encoded unless asked for JSON.
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  // GitHub reports failures as 200 with { error }.
  if (!token?.access_token) {
    throw providerError(`Token exchange failed${token?.error ? `: ${token.error}` : ''}`);
  }
  return token.access_token;
}
