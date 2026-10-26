import { createLogger } from '@pulseboard/shared/logger';
import { createApp } from '../src/app.js';

export const testEnv = {
  NODE_ENV: 'test',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-123',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: 7,
  TRUST_PROXY: false,
  DEMO_MODE: true,
  ALLOW_PRIVATE_TARGETS: true,
};

export function buildTestApp(overrides = {}) {
  return createApp({
    env: { ...testEnv, ...overrides.env },
    logger: createLogger({ name: 'api-test' }),
    ...overrides,
  });
}
