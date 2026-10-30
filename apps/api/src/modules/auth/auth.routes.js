import { loginSchema, registerSchema } from '@pulseboard/shared/schemas';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { createAuthLimiter, createRefreshLimiter } from '../../middleware/rateLimits.js';
import { validate } from '../../middleware/validate.js';
import { createAuthService } from './auth.service.js';
import { oauthRouter } from './oauth/oauth.routes.js';

export const REFRESH_COOKIE = 'pb_refresh';

export function authRouter({ env, tokens, logger, oauthFetch, activeUser }) {
  const router = Router();
  const auth = createAuthService({ env, tokens, logger });
  const authLimiter = createAuthLimiter(env.AUTH_RATE_LIMIT_MAX);
  const refreshLimiter = createRefreshLimiter(env.AUTH_RATE_LIMIT_MAX);

  // httpOnly: JavaScript (and so XSS) can't read it. Scoped to /api/v1/auth so the
  // browser only sends it to the endpoints that need it. SameSite=Lax is enough
  // because the client reaches the API on its own origin (Vite proxy / Vercel rewrite).
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
  };

  function setRefreshCookie(res, refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions,
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  function sendSession(res, status, { user, accessToken, refreshToken }) {
    setRefreshCookie(res, refreshToken);
    res.status(status).json({ data: { ...(user && { user }), accessToken } });
  }

  const meta = (req) => ({ userAgent: req.headers['user-agent'] });

  router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
    sendSession(res, 201, await auth.register(req.valid.body, meta(req)));
  });

  router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
    sendSession(res, 200, await auth.login(req.valid.body, meta(req)));
  });

  router.post('/refresh', refreshLimiter, async (req, res) => {
    try {
      sendSession(res, 200, await auth.refresh(req.cookies[REFRESH_COOKIE], meta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw err;
    }
  });

  router.post('/logout', async (req, res) => {
    await auth.logout(req.cookies[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).end();
  });

  // Sign in with Google / GitHub. Issues the same session (refresh cookie) as login.
  router.use('/oauth', oauthRouter({ env, auth, logger, setRefreshCookie, fetchImpl: oauthFetch }));

  router.get('/me', authenticate(tokens), activeUser, async (req, res) => {
    res.json({ data: await auth.me(req.userId) });
  });

  return router;
}
