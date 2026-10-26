import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import { z } from 'zod';

loadEnv();

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  CLIENT_ORIGIN: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  // Max login/register attempts per IP per 15 minutes.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  TRUST_PROXY: booleanString,
  DEMO_MODE: booleanString,
  ALLOW_PRIVATE_TARGETS: booleanString,
  LOG_LEVEL: z.string().default('info'),
});

export const env = parseEnv(envSchema);
