import { createHash } from 'node:crypto';
import { mongoose } from '@pulseboard/shared/db';
import { Membership, User, Workspace } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrations } from '../scripts/migrations/index.js';
import { createStateCookieCodec, sanitizeNext } from '../src/modules/auth/oauth/state.js';
import { buildTestApp, refreshCookie, testEnv } from './helpers.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const CALLBACK = 'http://localhost:5173/auth/callback';
const credentials = {
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GITHUB_CLIENT_ID: 'github-id',
  GITHUB_CLIENT_SECRET: 'github-secret',
};

// ---------- A fake provider: every outgoing request lands here ----------

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fake;
let calls;

function resetFake() {
  calls = [];
  fake = {
    token: () => json({ access_token: 'provider-access-token', token_type: 'bearer' }),
    googleUser: () =>
      json({ sub: 'g-123', email: 'Ada@Example.com', email_verified: true, name: 'Ada Lovelace' }),
    githubUser: () => json({ id: 42, login: 'ada', name: null }),
    githubEmails: () =>
      json([
        { email: 'old@example.com', primary: false, verified: true },
        { email: 'Ada@Example.com', primary: true, verified: true },
      ]),
  };
}
beforeEach(resetFake);

async function fakeFetch(url, init = {}) {
  calls.push({ url: String(url), init });
  const { host, pathname } = new URL(url);
  if (host === 'oauth2.googleapis.com' || pathname === '/login/oauth/access_token') {
    return fake.token();
  }
  if (host === 'openidconnect.googleapis.com') return fake.googleUser();
  if (pathname === '/user') return fake.githubUser();
  if (pathname === '/user/emails') return fake.githubEmails();
  throw new Error(`unexpected request to ${url}`);
}

const app = buildTestApp({ env: credentials, oauthFetch: fakeFetch });

// ---------- Flow helpers ----------

const cookieFrom = (res, name) =>
  (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

async function start(provider = 'google', next, target = app) {
  const res = await request(target)
    .get(`/api/v1/auth/oauth/${provider}/start`)
    .query(next === undefined ? {} : { next });
  const location = new URL(res.headers.location);
  const setCookie = cookieFrom(res, 'pb_oauth');
  return {
    res,
    location,
    state: location.searchParams.get('state'),
    setCookie,
    cookie: setCookie?.split(';')[0],
  };
}

async function callback(provider, { cookie, state, code = 'auth-code', extra = {} }) {
  const req = request(app)
    .get(`/api/v1/auth/oauth/${provider}/callback`)
    .query({ ...(code && { code }), ...(state && { state }), ...extra });
  if (cookie) req.set('Cookie', cookie);
  const res = await req;
  return { res, location: new URL(res.headers.location) };
}

async function signIn(provider = 'google', next) {
  const flow = await start(provider, next);
  return callback(provider, flow);
}

const params = (location) => Object.fromEntries(location.searchParams);
const decodeCookie = (cookie) =>
  JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url').toString());

async function meWith(res) {
  const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie(res));
  expect(refresh.status).toBe(200);
  const me = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${refresh.body.data.accessToken}`);
  return me.body.data;
}

// ---------- Tests ----------

describe('GET /auth/oauth/providers', () => {
  it('is empty when no provider is configured', async () => {
    const res = await request(buildTestApp()).get('/api/v1/auth/oauth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('lists only providers with both a client id and a secret', async () => {
    const half = buildTestApp({
      env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GITHUB_CLIENT_ID: 'id' },
    });
    expect((await request(half).get('/api/v1/auth/oauth/providers')).body).toEqual({
      data: [{ id: 'google', name: 'Google' }],
    });
    expect((await request(app).get('/api/v1/auth/oauth/providers')).body).toEqual({
      data: [
        { id: 'google', name: 'Google' },
        { id: 'github', name: 'GitHub' },
      ],
    });
  });
});

describe('GET /auth/oauth/:provider/start', () => {
  it('redirects to Google with state, PKCE S256, scopes and the callback URL', async () => {
    const { res, location, state, setCookie, cookie } = await start('google', '/app/monitors');

    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    const query = params(location);
    expect(query).toMatchObject({
      client_id: 'google-id',
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: 'http://localhost:5173/api/v1/auth/oauth/google/callback',
      code_challenge_method: 'S256',
    });
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(query.client_secret).toBeUndefined();

    // The cookie holds the verifier; the URL only its S256 challenge.
    const stored = decodeCookie(cookie);
    expect(stored).toMatchObject({ p: 'google', s: state, n: '/app/monitors' });
    const challenge = createHash('sha256').update(stored.v).digest('base64url');
    expect(query.code_challenge).toBe(challenge);
    expect(res.headers.location).not.toContain(stored.v);

    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth\/oauth/);
    expect(setCookie).toMatch(/Max-Age=600/);
  });

  it('redirects to GitHub with its scopes, and a fresh state every time', async () => {
    const first = await start('github');
    const second = await start('github');
    expect(first.location.origin + first.location.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(params(first.location)).toMatchObject({
      scope: 'read:user user:email',
      redirect_uri: 'http://localhost:5173/api/v1/auth/oauth/github/callback',
      code_challenge_method: 'S256',
    });
    expect(first.state).not.toBe(second.state);
  });

  it('uses APP_URL for the callback when it is set', async () => {
    const prod = buildTestApp({ env: { ...credentials, APP_URL: 'https://pulse.example.com/' } });
    const { location } = await start('google', undefined, prod);
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://pulse.example.com/api/v1/auth/oauth/google/callback',
    );
  });

  it('sends unknown or unconfigured providers back with OAUTH_NOT_CONFIGURED', async () => {
    for (const [target, provider] of [
      [app, 'facebook'],
      [buildTestApp(), 'google'],
    ]) {
      const res = await request(target).get(`/api/v1/auth/oauth/${provider}/start`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${CALLBACK}?status=error&code=OAUTH_NOT_CONFIGURED`);
      expect(cookieFrom(res, 'pb_oauth')).toBeUndefined();
    }
  });

  it('is rate limited, answering with a redirect', async () => {
    const limited = buildTestApp({
      env: { ...credentials, AUTH_RATE_LIMIT_MAX: 1 },
      oauthFetch: fakeFetch,
    });
    await start('google', undefined, limited);
    await start('google', undefined, limited);
    const { res } = await start('google', undefined, limited);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CALLBACK}?status=error&code=RATE_LIMITED`);
  });
});

describe('GET /auth/oauth/:provider/callback: happy paths', () => {
  it('creates a new user with their own workspace and signs them in', async () => {
    const { res, location } = await signIn('google', '/app/monitors?tab=down');

    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(params(location)).toEqual({ status: 'ok', next: '/app/monitors?tab=down' });
    // Tokens never travel in the URL.
    expect(res.headers.location).not.toMatch(/eyJ|token/i);

    expect(refreshCookie(res)).toBeTruthy();
    expect(cookieFrom(res, 'pb_refresh')).toMatch(/Path=\/api\/v1\/auth;/);
    expect(cookieFrom(res, 'pb_oauth')).toMatch(/pb_oauth=;/); // cleared

    const user = await User.findOne().select('+passwordHash');
    expect(user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(user.passwordHash).toBeUndefined();
    expect(user.identities.map((i) => i.toObject())).toEqual([
      expect.objectContaining({
        provider: 'google',
        providerId: 'g-123',
        email: 'ada@example.com',
      }),
    ]);
    const workspace = await Workspace.findOne({ ownerId: user._id });
    expect(workspace.name).toBe("Ada's workspace");
    expect(await Membership.countDocuments({ userId: user._id, role: 'owner' })).toBe(1);

    const me = await meWith(res);
    expect(me.user).toMatchObject({ providers: ['google'], hasPassword: false });
    expect(me.workspaces).toHaveLength(1);
  });

  it('exchanges the code with the PKCE verifier and the client secret', async () => {
    const flow = await start('google');
    const codeVerifier = decodeCookie(flow.cookie).v;
    await callback('google', { ...flow, code: 'the-code' });

    const [tokenCall, profileCall] = calls;
    expect(tokenCall.url).toBe('https://oauth2.googleapis.com/token');
    expect(tokenCall.init.method).toBe('POST');
    expect(Object.fromEntries(tokenCall.init.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost:5173/api/v1/auth/oauth/google/callback',
      client_id: 'google-id',
      client_secret: 'google-secret',
      code_verifier: codeVerifier,
    });
    expect(profileCall.init.headers.Authorization).toBe('Bearer provider-access-token');
  });

  it('links a verified email to the existing password account', async () => {
    const registered = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: 'password123' });

    const { res, location } = await signIn('google');
    expect(params(location).status).toBe('ok');

    expect(await User.countDocuments()).toBe(1);
    const me = await meWith(res);
    expect(me.user.id).toBe(registered.body.data.user.id);
    expect(me.user).toMatchObject({ providers: ['google'], hasPassword: true });

    // The password still works after linking.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' });
    expect(login.status).toBe(200);
  });

  it('signs an existing identity in to the same user, even if the email changed', async () => {
    await signIn('google');
    fake.googleUser = () =>
      json({ sub: 'g-123', email: 'new@example.com', email_verified: true, name: 'Ada' });
    const { res, location } = await signIn('google');

    expect(params(location).status).toBe('ok');
    expect(await User.countDocuments()).toBe(1);
    const user = await User.findOne();
    expect(user.email).toBe('ada@example.com');
    expect(user.identities).toHaveLength(1);
    expect((await meWith(res)).user.providers).toEqual(['google']);
  });

  it('GitHub: uses the primary verified email and the numeric id as a string', async () => {
    const { res, location } = await signIn('github');
    expect(params(location).status).toBe('ok');

    const user = await User.findOne();
    expect(user).toMatchObject({ name: 'ada', email: 'ada@example.com' }); // login as name fallback
    expect(user.identities[0]).toMatchObject({ provider: 'github', providerId: '42' });

    const githubCalls = calls.filter((c) => c.url.startsWith('https://api.github.com'));
    expect(githubCalls.map((c) => c.url)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/user/emails',
    ]);
    expect(githubCalls[0].init.headers['User-Agent']).toBeTruthy();
    expect(calls[0].init.headers.Accept).toBe('application/json');

    // Same person, second provider: linked to the same user.
    await signIn('google');
    expect(await User.countDocuments()).toBe(1);
    expect((await meWith(res)).user.providers.sort()).toEqual(['github', 'google']);
  });
});

describe('GET /auth/oauth/:provider/callback: refusals', () => {
  const expectError = ({ res, location }, code) => {
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(params(location)).toEqual({ status: 'error', code });
    expect(refreshCookie(res)).toBeFalsy();
  };

  it('refuses an unverified email: no link, no new user', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    fake.googleUser = () =>
      json({ sub: 'g-evil', email: 'ada@example.com', email_verified: false, name: 'Mallory' });

    expectError(await signIn('google'), 'OAUTH_EMAIL_UNVERIFIED');
    expect(await User.countDocuments()).toBe(1);
    expect((await User.findOne()).identities).toHaveLength(0);
  });

  it('refuses a GitHub account whose primary email is unverified, or that has none', async () => {
    fake.githubEmails = () =>
      json([
        { email: 'ada@example.com', primary: true, verified: false },
        { email: 'other@example.com', primary: false, verified: true },
      ]);
    expectError(await signIn('github'), 'OAUTH_EMAIL_UNVERIFIED');

    fake.githubEmails = () => json([]);
    expectError(await signIn('github'), 'OAUTH_EMAIL_UNVERIFIED');
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a state that does not match the cookie', async () => {
    const flow = await start('google');
    expectError(
      await callback('google', { ...flow, state: 'x'.repeat(43) }),
      'OAUTH_STATE_INVALID',
    );
    expect(calls).toHaveLength(0); // the code is never exchanged
  });

  it('rejects a missing or tampered cookie, or one issued for another provider', async () => {
    const flow = await start('google');
    expectError(await callback('google', { state: flow.state }), 'OAUTH_STATE_INVALID');

    const [payload, signature] = flow.cookie.split('=')[1].split('.');
    const edited = Buffer.from(
      JSON.stringify({ ...decodeCookie(flow.cookie), n: '/app/evil' }),
    ).toString('base64url');
    expectError(
      await callback('google', { state: flow.state, cookie: `pb_oauth=${edited}.${signature}` }),
      'OAUTH_STATE_INVALID',
    );
    expect(payload).not.toBe(edited);

    const githubFlow = await start('github');
    expectError(await callback('google', githubFlow), 'OAUTH_STATE_INVALID');
    expect(calls).toHaveLength(0);
  });

  it('rejects an expired state cookie', () => {
    const codec = createStateCookieCodec(testEnv.JWT_REFRESH_SECRET);
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const cookie = codec.encode(
      { provider: 'google', state: 's', codeVerifier: 'v', next: '/app' },
      elevenMinutesAgo,
    );
    expect(codec.decode(cookie)).toBeNull();
    expect(codec.decode(cookie, elevenMinutesAgo)).toMatchObject({ provider: 'google' });
  });

  it('reports access_denied as OAUTH_DENIED and other provider errors as OAUTH_PROVIDER_ERROR', async () => {
    const flow = await start('google');
    expectError(
      await callback('google', { ...flow, code: null, extra: { error: 'access_denied' } }),
      'OAUTH_DENIED',
    );
    expectError(
      await callback('google', { ...flow, code: null, extra: { error: 'server_error' } }),
      'OAUTH_PROVIDER_ERROR',
    );
    expect(calls).toHaveLength(0);
  });

  it('maps a provider 500, an error body or a network failure to OAUTH_PROVIDER_ERROR', async () => {
    fake.token = () => json({ error: 'boom' }, 500);
    expectError(await signIn('google'), 'OAUTH_PROVIDER_ERROR');

    // GitHub reports a bad code as 200 { error }.
    fake.token = () => json({ error: 'bad_verification_code' });
    expectError(await signIn('github'), 'OAUTH_PROVIDER_ERROR');

    resetFake();
    fake.googleUser = () => {
      throw new TypeError('fetch failed');
    };
    expectError(await signIn('google'), 'OAUTH_PROVIDER_ERROR');
    expect(await User.countDocuments()).toBe(0);
  });

  it('a callback cannot be replayed: the state cookie is single use', async () => {
    const flow = await start('google');
    const first = await callback('google', flow);
    expect(params(first.location).status).toBe('ok');
    // The browser drops the cleared cookie, so a replay of the URL has no state.
    expectError(await callback('google', { state: flow.state }), 'OAUTH_STATE_INVALID');
  });
});

describe('next sanitisation', () => {
  it.each([
    ['/app/monitors/abc?x=1#y', '/app/monitors/abc?x=1#y'],
    ['/status/acme', '/status/acme'],
    ['//evil.com', '/app'],
    ['//evil.com/app', '/app'],
    ['/\\evil.com', '/app'],
    ['/app\\..\\x', '/app'],
    ['https://evil.com', '/app'],
    ['javascript:alert(1)', '/app'],
    ['app/monitors', '/app'],
    ['/app\nSet-Cookie: x', '/app'],
    ['/\t/evil.com', '/app'],
    ['', '/app'],
    [undefined, '/app'],
    [['/a', '/b'], '/app'],
    [`/${'a'.repeat(600)}`, '/app'],
  ])('%j -> %s', (input, expected) => {
    expect(sanitizeNext(input)).toBe(expected);
  });

  it('is applied end to end', async () => {
    const { location } = await signIn('google', '//evil.com');
    expect(params(location)).toEqual({ status: 'ok', next: '/app' });

    const plain = await signIn('google');
    expect(params(plain.location).next).toBe('/app');
  });
});

describe('OAuth-only users and passwords', () => {
  it('password login for an OAuth-only user gives the generic invalid-credentials error', async () => {
    await signIn('google');
    const oauthOnly = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(oauthOnly.status).toBe(401);
    expect(oauthOnly.body).toEqual(unknown.body);
    expect(oauthOnly.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('registering with the email of an OAuth-only user is still a conflict', async () => {
    await signIn('google');
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Eve', email: 'ada@example.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('user JSON never contains the password hash or provider account ids', async () => {
    const register = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    const { res } = await signIn('google');
    const me = await meWith(res);

    for (const body of [register.body, me]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain('passwordHash');
      expect(text).not.toContain('identities');
      expect(text).not.toContain('g-123');
      expect(text).not.toContain('providerId');
    }
    expect(Object.keys(me.user).sort()).toEqual(
      ['createdAt', 'email', 'hasPassword', 'id', 'name', 'providers', 'updatedAt'].sort(),
    );
  });
});

describe('migration 003-user-identities', () => {
  const migration = migrations.find((m) => m.name === '003-user-identities');
  const indexName = 'identities_provider_providerId';

  it('creates the unique partial index, is idempotent, and leaves existing users alone', async () => {
    const users = mongoose.connection.db.collection('users');
    await users.dropIndex(indexName); // a database from before this upgrade
    // A factory: insertOne adds _id to the object it is given.
    const legacy = () => ({
      name: 'Old',
      email: 'old@example.com',
      passwordHash: '$2b$04$abcdefghijklmnopqrstuv',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const { insertedId } = await users.insertOne(legacy());
    await users.insertOne({ ...legacy(), email: 'old2@example.com' });

    expect(await migration.up(mongoose.connection.db)).toEqual({ modified: 0, index: indexName });
    const before = await users.find().toArray();
    expect(await migration.up(mongoose.connection.db)).toEqual({ modified: 0, index: indexName });
    expect(await users.find().toArray()).toEqual(before);
    expect(await users.findOne({ _id: insertedId })).toEqual({ _id: insertedId, ...legacy() });

    const index = (await users.indexes()).find((i) => i.name === indexName);
    expect(index).toMatchObject({
      unique: true,
      key: { 'identities.provider': 1, 'identities.providerId': 1 },
      partialFilterExpression: { 'identities.providerId': { $exists: true } },
    });

    // The index is enforced: one provider account can't belong to two users.
    const identity = { provider: 'google', providerId: 'same' };
    await users.updateOne({ email: 'old@example.com' }, { $push: { identities: identity } });
    await expect(
      users.updateOne({ email: 'old2@example.com' }, { $push: { identities: identity } }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('a legacy user (no identities field) still logs in with their password', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Old', email: 'old@example.com', password: 'password123' });
    await mongoose.connection.db
      .collection('users')
      .updateOne({ email: 'old@example.com' }, { $unset: { identities: '' } });
    await migration.up(mongoose.connection.db);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'old@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.data.user).toMatchObject({ providers: [], hasPassword: true });
  });
});
