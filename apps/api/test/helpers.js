import { createLogger } from '@pulseboard/shared/logger';
import request from 'supertest';
import { createApp } from '../src/app.js';

export const testEnv = {
  NODE_ENV: 'test',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-123',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: 7,
  // Cost 4 instead of 12 keeps the suite fast; the hashing code path is identical.
  BCRYPT_COST: 4,
  AUTH_RATE_LIMIT_MAX: 1000,
  TRUST_PROXY: false,
  DEMO_MODE: true,
  ALLOW_PRIVATE_TARGETS: true,
  DASHBOARD_URL: 'http://localhost:5173',
};

export function buildTestApp({ env, ...overrides } = {}) {
  return createApp({
    env: { ...testEnv, ...env },
    logger: createLogger({ name: 'api-test' }),
    ...overrides,
  });
}

/** Extracts "pb_refresh=<token>" from a response's Set-Cookie header. */
export function refreshCookie(res) {
  const header = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('pb_refresh='));
  return header?.split(';')[0];
}

let userCounter = 0;

/**
 * Registers a fresh user and returns everything a test needs to act as them:
 * access token, refresh cookie, user, and their personal workspace id.
 */
export async function registerUser(app, { name = 'Test User', email } = {}) {
  userCounter += 1;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ name, email: email ?? `user${userCounter}@example.com`, password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);

  const { accessToken, user } = res.body.data;
  const me = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${accessToken}`);
  return {
    user,
    accessToken,
    cookie: refreshCookie(res),
    workspaceId: me.body.data.workspaces[0].id,
    auth: { Authorization: `Bearer ${accessToken}` },
  };
}
