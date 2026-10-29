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
 * worker. RESEND_API_KEY wins over SMTP; with neither set, an Ethereal test inbox
 * is used (development).
 */
export const alertEnvFields = {
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),
  // Public URL of the web app, used in the checker's User-Agent ("+APP_URL/bot").
  // Defaults to DASHBOARD_URL (see appUrlOf).
  APP_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
  SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  // Email over Resend's HTTPS API. Set it where outbound SMTP is blocked (Render's free plan).
  RESEND_API_KEY: z.string().trim().default(''),
  ALERT_FROM_EMAIL: z.string().default('PulseBoard <alerts@pulseboard.local>'),
};

/**
 * Public-demo settings, shared by the API (meta, workspace creation), the worker (daily reset) and
 * the seed. DEMO_READ_ONLY makes the demo user a read-only Viewer; DEMO_OWNER_EMAIL names the
 * account that owns the demo workspace (empty: a login-less one is created).
 */
export const demoEnvFields = {
  DEMO_READ_ONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DEMO_OWNER_EMAIL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined),
    z.string().email().optional(),
  ),
};

/** The public web app URL: APP_URL if set, else DASHBOARD_URL. */
export const appUrlOf = (env) => env.APP_URL ?? env.DASHBOARD_URL;

export const alertSenderConfig = (env) => ({
  smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
  from: env.ALERT_FROM_EMAIL,
  resendApiKey: env.RESEND_API_KEY || undefined,
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A warning when alert links would not work for the people receiving them, or
 * null. In production "Open dashboard" must point at the public client URL;
 * DASHBOARD_URL defaults to http://localhost:5173, so forgetting to set it on
 * the host silently sends everyone to their own machine.
 */
export function dashboardUrlWarning(env) {
  if (env.NODE_ENV !== 'production') return null;
  let host;
  try {
    host = new URL(env.DASHBOARD_URL).hostname;
  } catch {
    return 'DASHBOARD_URL is not a valid URL: links in alerts will be broken.';
  }
  if (LOCAL_HOSTS.has(host)) {
    return `DASHBOARD_URL points at ${host}: "Open dashboard" links in alerts will not work. Set it to the public client URL.`;
  }
  return null;
}
