import { appUrlOf } from '@pulseboard/shared/env';
import { Router } from 'express';
import { AppError } from '../../../lib/errors.js';
import { createOAuthLimiter } from '../../../middleware/rateLimits.js';
import { buildAuthorizeUrl, enabledProviders, exchangeToken, OAuthError } from './providers.js';
import {
  createPkce,
  createState,
  createStateCookieCodec,
  OAUTH_COOKIE,
  OAUTH_STATE_TTL_MS,
  safeEqual,
  sanitizeNext,
} from './state.js';

const query = (req, key) => (typeof req.query[key] === 'string' ? req.query[key] : undefined);

/**
 * Sign in with Google / GitHub (authorization code + PKCE).
 *
 * Both endpoints are browser navigations, so they always answer with a 302 to
 * the client's /auth/callback page: ?status=ok&next=... on success, or
 * ?status=error&code=... on failure. No token ever appears in a URL: on
 * success the refresh cookie is set and the client calls /auth/refresh.
 */
export function oauthRouter({ env, auth, logger, setRefreshCookie, fetchImpl = globalThis.fetch }) {
  const router = Router();
  const appUrl = appUrlOf(env).replace(/\/+$/, '');
  const providers = new Map(enabledProviders(env).map((provider) => [provider.id, provider]));
  const codec = createStateCookieCodec(env.JWT_REFRESH_SECRET);

  // The provider redirects the browser to the client origin, which proxies /api
  // to us (Vite in dev, Vercel rewrite in prod), so the cookie stays first-party.
  const redirectUriFor = (id) => `${appUrl}/api/v1/auth/oauth/${id}/callback`;

  // SameSite=Lax: the provider's redirect back is a top-level GET, which Lax allows.
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth/oauth',
  };

  const finish = (res, params) =>
    res.redirect(302, `${appUrl}/auth/callback?${new URLSearchParams(params)}`);
  const fail = (res, code) => finish(res, { status: 'error', code });

  const limiter = createOAuthLimiter(env.AUTH_RATE_LIMIT_MAX, (_req, res) =>
    fail(res, 'RATE_LIMITED'),
  );

  router.get('/providers', (_req, res) => {
    res.json({ data: [...providers.values()].map(({ id, name }) => ({ id, name })) });
  });

  router.get('/:provider/start', limiter, (req, res) => {
    const provider = providers.get(req.params.provider);
    if (!provider) return fail(res, 'OAUTH_NOT_CONFIGURED');

    const state = createState();
    const { codeVerifier, codeChallenge } = createPkce();
    const next = sanitizeNext(query(req, 'next'));
    res.cookie(OAUTH_COOKIE, codec.encode({ provider: provider.id, state, codeVerifier, next }), {
      ...cookieOptions,
      maxAge: OAUTH_STATE_TTL_MS,
    });
    res.redirect(
      302,
      buildAuthorizeUrl(provider, {
        redirectUri: redirectUriFor(provider.id),
        state,
        codeChallenge,
      }),
    );
  });

  router.get('/:provider/callback', limiter, async (req, res) => {
    const provider = providers.get(req.params.provider);
    const stored = codec.decode(req.cookies[OAUTH_COOKIE]);
    // Single use: whatever happens next, this sign-in attempt is over.
    res.clearCookie(OAUTH_COOKIE, cookieOptions);

    if (!provider) return fail(res, 'OAUTH_NOT_CONFIGURED');

    const providerErrorParam = query(req, 'error');
    if (providerErrorParam) {
      return fail(
        res,
        providerErrorParam === 'access_denied' ? 'OAUTH_DENIED' : 'OAUTH_PROVIDER_ERROR',
      );
    }

    const code = query(req, 'code');
    if (
      !stored ||
      stored.provider !== provider.id ||
      !safeEqual(query(req, 'state'), stored.state)
    ) {
      return fail(res, 'OAUTH_STATE_INVALID');
    }
    if (!code) return fail(res, 'OAUTH_PROVIDER_ERROR');

    try {
      const { accessToken, scope } = await exchangeToken(
        provider,
        { code, codeVerifier: stored.codeVerifier, redirectUri: redirectUriFor(provider.id) },
        fetchImpl,
      );
      const profile = await provider.fetchProfile(accessToken, fetchImpl);
      const session = await auth.oauthSignIn(
        provider.id,
        profile,
        { userAgent: req.headers['user-agent'] },
        { accessToken, scope },
      );
      setRefreshCookie(res, session.refreshToken);
      return finish(res, { status: 'ok', next: stored.next });
    } catch (err) {
      if (err instanceof OAuthError) {
        logger.warn({ provider: provider.id, err: err.message }, 'OAuth sign-in failed');
        return fail(res, err.code);
      }
      if (err instanceof AppError) return fail(res, err.code);
      logger.error({ err, provider: provider.id }, 'OAuth sign-in crashed');
      return fail(res, 'INTERNAL');
    }
  });

  return router;
}
