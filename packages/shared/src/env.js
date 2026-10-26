import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const ROOT_ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');

/**
 * Loads the monorepo-root .env into process.env (without overriding variables
 * already set). In production there is no .env file and the platform injects
 * variables directly, so a missing file is fine.
 */
export function loadEnv() {
  if (existsSync(ROOT_ENV_PATH)) dotenv.config({ path: ROOT_ENV_PATH, quiet: true });
}

/** Parses process.env with a Zod schema and exits with a readable message on failure. */
export function parseEnv(schema, source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/**
 * Alert-delivery settings, used by both the API ("send test alert") and the
 * worker. Empty SMTP_HOST means "use an Ethereal test inbox" (development).
 */
export const alertEnvFields = {
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  ALERT_FROM_EMAIL: z.string().default('PulseBoard <alerts@pulseboard.local>'),
};

export const alertSenderConfig = (env) => ({
  smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
  from: env.ALERT_FROM_EMAIL,
});
