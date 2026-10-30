import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '@pulseboard/shared/env';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { envSchema } from '../src/config/env.js';
import {
  ensureAdminAccount,
  MIN_ADMIN_PASSWORD_LENGTH,
} from '../src/modules/admin/admin.service.js';
import { buildTestApp, testEnv } from './helpers.js';

// The evaluation admin published in the README must be the one `.env.example` carries, must be
// valid, and must really let someone in. If anyone edits one and not the others, this fails.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const example = readFileSync(join(repoRoot, '.env.example'), 'utf8');
const fromExample = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(example)?.[1].trim();

const email = fromExample('ADMIN_EMAIL');
const password = fromExample('ADMIN_PASSWORD');

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe('the evaluation admin account in the README', () => {
  it('is set in .env.example and is a valid pair', () => {
    expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(password.length).toBeGreaterThanOrEqual(MIN_ADMIN_PASSWORD_LENGTH);
  });

  it('is published in the README exactly as .env.example has it', () => {
    expect(readme).toContain(`\`${email}\``);
    expect(readme).toContain(`\`${password}\``);
  });

  it('is the dedicated evaluation address, not a personal one', () => {
    expect(email).toBe('admin@pulseboard.com');
  });

  it('parses with the API environment schema', () => {
    const parsed = parseEnv(envSchema, {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost/x',
      CLIENT_ORIGIN: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: password,
    });
    expect(parsed.ADMIN_EMAIL).toBe(email);
    expect(parsed.ADMIN_PASSWORD).toBe(password);
  });

  it('signs in to the admin panel once the API has created it', async () => {
    const env = { ...testEnv, ADMIN_EMAIL: email, ADMIN_PASSWORD: password };
    expect(await ensureAdminAccount({ env })).toBe('created');
    const app = buildTestApp({ env: { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } });

    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };

    const me = await request(app).get('/api/v1/auth/me').set(auth);
    expect(me.body.data.isAdmin).toBe(true);
    expect((await request(app).get('/api/v1/admin/users').set(auth)).status).toBe(200);

    // A wrong password gets nowhere.
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'nope-nope-nope' });
    expect(bad.status).toBe(401);
  });
});
