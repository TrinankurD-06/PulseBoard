import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

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
