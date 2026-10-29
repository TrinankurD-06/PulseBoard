import { alertEnvFields, demoEnvFields, loadEnv, parseEnv } from '@pulseboard/shared/env';
import { z } from 'zod';

loadEnv();

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().min(1),
  WORKER_HEALTH_PORT: z.coerce.number().int().default(4002),
  AGENDA_MAX_CONCURRENCY: z.coerce.number().int().positive().default(20),
  DEMO_MODE: booleanString,
  ALLOW_PRIVATE_TARGETS: booleanString,
  LOG_LEVEL: z.string().default('info'),
  ...alertEnvFields,
  ...demoEnvFields,
});

export const env = parseEnv(envSchema);
