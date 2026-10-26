import { Session } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, refreshCookie, registerUser } from './helpers.js';

const app = buildTestApp();

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const credentials = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'password123' };

describe('POST /auth/register', () => {
  it('creates the user, an owned personal workspace, and a session', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(credentials);

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('pb_refresh='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.body.data.workspaces).toHaveLength(1);
    expect(me.body.data.workspaces[0]).toMatchObject({ name: "Ada's workspace", role: 'owner' });
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/v1/auth/register').send(credentials);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...credentials, email: 'ADA@example.com' });
    expect(res.status).toBe(409);
  });

  it('validates input and reports which fields are wrong', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send(credentials);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeTruthy();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('is not vulnerable to operator injection', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it('is rate limited per IP', async () => {
    const limitedApp = buildTestApp({ env: { AUTH_RATE_LIMIT_MAX: 2 } });
    const attempt = () =>
      request(limitedApp)
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.com', password: 'x' });
    await attempt();
    await attempt();
    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /auth/me', () => {
  it('requires a valid access token', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer nonsense');
    expect(res.status).toBe(401);
  });

  it('does not accept a refresh token as an access token', async () => {
    const { cookie } = await registerUser(app);
    const refreshToken = cookie.split('=')[1];
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh (rotation)', () => {
  it('issues a new access token and rotates the refresh token', async () => {
    const { cookie } = await registerUser(app);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const rotated = refreshCookie(res);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(cookie);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { cookie: original } = await registerUser(app);
    const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    const rotated = refreshCookie(first);

    // An attacker replays the original (already used) token...
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    // ...so the legitimate, newer token stops working too.
    const legit = await request(app).post('/api/v1/auth/refresh').set('Cookie', rotated);
    expect(legit.status).toBe(401);
    expect(await Session.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('rejects missing or forged refresh tokens', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
    const forged = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'pb_refresh=eyJhbGciOiJIUzI1NiJ9.e30.forged');
    expect(forged.status).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const { cookie } = await registerUser(app);
    const token = cookie.split('=')[1];
    const session = await Session.findOne();
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { cookie } = await registerUser(app);

    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/pb_refresh=;/);

    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });
});
