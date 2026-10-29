import { mongoose } from '@pulseboard/shared/db';
import { Monitor, StatusPage, User } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenCrypto } from '../src/lib/tokenCrypto.js';
import { buildTestApp, refreshCookie, registerUser, testEnv } from './helpers.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

const crypto = createTokenCrypto(testEnv);
const TOKEN = 'gho_test_token_value';

// ---------- A fake GitHub: every outgoing request lands here ----------

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const repo = (name, extra = {}) => ({
  name,
  full_name: `ada/${name}`,
  html_url: `https://github.com/ada/${name}`,
  fork: false,
  archived: false,
  private: false,
  has_pages: false,
  homepage: '',
  ...extra,
});

let github; // scenario: { repos, deployments, statuses, readmes, pages, rate }
let calls; // every URL requested from GitHub
let probes; // every URL probed

const defaultGithub = () => ({
  repos: [
    repo('shop', { homepage: 'https://shop.example.com/' }),
    repo('site', { has_pages: true }),
    repo('old', { archived: true, homepage: 'https://old.example.com' }),
    repo('forky', { fork: true, homepage: 'https://forky.example.com' }),
    repo('empty'),
  ],
  deployments: {
    'ada/shop': [
      { id: 11, environment: 'Production' },
      { id: 10, environment: 'Preview' },
      { id: 9, environment: 'Production' },
    ],
  },
  statuses: { 11: [{ environment_url: 'https://shop-prod.vercel.app' }] },
  pages: { 'ada/site': { html_url: 'https://ada.github.io/site/' } },
  readmes: { 'ada/site': 'See the [live demo](https://site-demo.netlify.app) and ![x](a.png)' },
  rate: { remaining: 4000, reset: 1_900_000_000 },
  listStatus: 200,
});

async function fakeGithub(url, init = {}) {
  const asked = new URL(url);
  calls.push(`${asked.pathname}${asked.search}`);
  expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(init.headers['User-Agent']).toBe('PulseBoard');
  const rate = github.rate;
  rate.remaining -= 1;
  const headers = {
    'x-ratelimit-remaining': String(rate.remaining),
    'x-ratelimit-reset': String(rate.reset),
  };
  const path = asked.pathname;

  if (path === '/users/ada/repos') {
    if (github.listStatus !== 200) {
      return json({ message: 'rate limit exceeded' }, github.listStatus, {
        ...headers,
        'x-ratelimit-remaining': '0',
      });
    }
    const page = Number(asked.searchParams.get('page'));
    const slice = github.repos.slice((page - 1) * 100, page * 100);
    const more = page * 100 < github.repos.length;
    return json(slice, 200, {
      ...headers,
      ...(more && { link: '<https://api.github.com/x?page=2>; rel="next"' }),
    });
  }
  let match = /^\/repos\/ada\/([^/]+)\/(pages|readme|deployments)$/.exec(path);
  if (match) {
    const full = `ada/${match[1]}`;
    if (match[2] === 'pages') {
      return github.pages[full] ? json(github.pages[full], 200, headers) : json({}, 404, headers);
    }
    if (match[2] === 'deployments') return json(github.deployments[full] ?? [], 200, headers);
    if (!github.readmes[full]) return json({}, 404, headers);
    return new Response(github.readmes[full], { status: 200, headers });
  }
  match = /^\/repos\/ada\/[^/]+\/deployments\/(\d+)\/statuses$/.exec(path);
  if (match) return json(github.statuses[match[1]] ?? [], 200, headers);
  throw new Error(`unexpected GitHub request ${url}`);
}

// Probe fake: everything answers 200 on the same URL unless a rule says otherwise.
let probeRules;
async function fakeProbe(url) {
  probes.push(url);
  return (
    probeRules[url] ?? { ok: true, statusCode: 200, finalUrl: url, errorCode: null, error: null }
  );
}

function fakeScheduler() {
  const list = [];
  return {
    calls: list,
    async scheduleMonitor(monitor) {
      list.push(['schedule', String(monitor._id), monitor.intervalSec]);
    },
    async cancelMonitor(monitorId) {
      list.push(['cancel', String(monitorId)]);
    },
  };
}

const scheduler = fakeScheduler();
const app = buildTestApp({ scheduler, githubFetch: fakeGithub, githubProbe: fakeProbe });

let owner, viewer, wid;

async function linkGithub(user, { token = TOKEN, login = 'ada' } = {}) {
  await User.updateOne(
    { _id: user.user.id },
    {
      $push: {
        identities: {
          provider: 'github',
          providerId: `gh-${user.user.id}`,
          login,
          ...(token && { tokenEnc: crypto.encrypt(token), tokenScope: 'read:user,user:email' }),
        },
      },
    },
  );
}

const url = (path) => `/api/v1/workspaces/${wid}/github${path}`;
const candidates = (as = owner, query = '') =>
  request(app)
    .get(url(`/candidates${query}`))
    .set(as.auth);
const importUrls = (body, as = owner, target = app) =>
  request(target).post(url('/import')).set(as.auth).send(body);

beforeEach(async () => {
  await clearMemoryDb();
  scheduler.calls.length = 0;
  github = defaultGithub();
  calls = [];
  probes = [];
  probeRules = {};
  owner = await registerUser(app, { name: 'Owner' });
  viewer = await registerUser(app, { name: 'Viewer' });
  wid = owner.workspaceId;
  await request(app)
    .post(`/api/v1/workspaces/${wid}/members`)
    .set(owner.auth)
    .send({ email: viewer.user.email, role: 'viewer' });
  await linkGithub(owner);
  await linkGithub(viewer);
});

describe('GET /github/candidates', () => {
  it('lists public, non-archived, non-fork repos with ranked, probed candidates', async () => {
    probeRules['https://shop.example.com/'] = {
      ok: true,
      statusCode: 200,
      finalUrl: 'https://www.shop-new.com/home',
    };
    probeRules['https://ada.github.io/site'] = { ok: false, statusCode: 404, finalUrl: '' };

    const res = await candidates();
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toMatchObject({
      githubLogin: 'ada',
      cached: false,
      rateLimit: { remaining: expect.any(Number), resetAt: '2030-03-17T17:46:40.000Z' },
    });
    expect(Date.parse(data.fetchedAt)).not.toBeNaN();

    // "old" is archived, "forky" a fork, "empty" has nothing: all omitted.
    expect(data.repos.map((entry) => entry.repo)).toEqual(['ada/shop', 'ada/site']);
    const [shop, site] = data.repos;
    expect(shop).toMatchObject({
      name: 'shop',
      htmlUrl: 'https://github.com/ada/shop',
      isFork: false,
    });
    // deployment (latest Production status; Preview skipped) outranks homepage.
    expect(shop.candidates).toEqual([
      {
        url: 'https://shop-prod.vercel.app/',
        finalUrl: 'https://shop-prod.vercel.app/',
        source: 'deployment',
        status: 'live',
        statusCode: 200,
        monitored: false,
      },
      {
        url: 'https://shop.example.com/',
        finalUrl: 'https://www.shop-new.com/home',
        source: 'homepage',
        status: 'redirect',
        statusCode: 200,
        monitored: false,
      },
    ]);
    expect(site.candidates.map((c) => [c.source, c.status])).toEqual([
      ['pages', 'down'],
      ['readme', 'live'],
    ]);
    expect(site.candidates[1].url).toBe('https://site-demo.netlify.app/');
    // Every candidate was probed once; the fork and archived repos never.
    expect(probes).toHaveLength(4);
  });

  it('includes forks only with ?forks=true', async () => {
    const res = await candidates(owner, '?forks=true');
    expect(res.body.data.repos.map((entry) => [entry.repo, entry.isFork])).toEqual([
      ['ada/shop', false],
      ['ada/site', false],
      ['ada/forky', true],
    ]);
    expect(
      (await candidates(owner, '?forks=false')).body.data.repos.some((entry) => entry.isFork),
    ).toBe(false);
    expect((await candidates(owner, '?forks=maybe')).status).toBe(400);
  });

  it('caches per user and forks flag, then serves from the cache without calling GitHub', async () => {
    const first = await candidates();
    expect(first.body.data.cached).toBe(false);
    const githubCalls = calls.length;
    const probeCalls = probes.length;

    const second = await candidates();
    expect(second.body.data.cached).toBe(true);
    expect(second.body.data.repos).toEqual(first.body.data.repos);
    expect(calls).toHaveLength(githubCalls);
    expect(probes).toHaveLength(probeCalls);

    // Another forks flag is a different cache entry.
    expect((await candidates(owner, '?forks=true')).body.data.cached).toBe(false);
  });

  it('marks URLs the workspace already monitors, also when the final URL matches', async () => {
    probeRules['https://shop.example.com/'] = {
      ok: true,
      statusCode: 200,
      finalUrl: 'https://shop-final.example.org/',
    };
    const direct = await Monitor.create({
      workspaceId: wid,
      name: 'Prod',
      url: 'http://www.shop-prod.vercel.app',
      intervalSec: 60,
    });
    const viaRedirect = await Monitor.create({
      workspaceId: wid,
      name: 'Final',
      url: 'https://shop-final.example.org',
      intervalSec: 60,
    });

    const { repos } = (await candidates()).body.data;
    expect(repos[0].candidates[0]).toMatchObject({
      monitored: true,
      monitorId: String(direct._id),
    });
    expect(repos[0].candidates[1]).toMatchObject({
      monitored: true,
      monitorId: String(viaRedirect._id),
    });
    expect(repos[1].candidates.every((c) => c.monitored === false && !('monitorId' in c))).toBe(
      true,
    );

    // The cache is shared, the marking is not: another workspace sees nothing monitored.
    const other = await registerUser(app, { name: 'Other' });
    await linkGithub(other);
    wid = other.workspaceId;
    const theirs = (await candidates(other)).body.data;
    expect(theirs.repos.flatMap((r) => r.candidates).some((c) => c.monitored)).toBe(false);
  });

  it('paginates the repository list and skips archived ones before applying the cap', async () => {
    github.repos = [
      ...Array.from({ length: 100 }, (_, i) => repo(`arch${i}`, { archived: true })),
      repo('late', { homepage: 'https://late.example.com' }),
    ];
    const res = await candidates();
    expect(res.status).toBe(200);
    expect(res.body.data.repos.map((entry) => entry.repo)).toEqual(['ada/late']);
    const pages = calls.filter((c) => c.startsWith('/users/ada/repos')).map((c) => c.slice(-6));
    expect(pages).toEqual(['page=1', 'page=2']);
    expect(calls[0]).toContain('type=owner&sort=pushed&per_page=100');
  });

  it('answers 429 GITHUB_RATE_LIMITED with resetAt when the repo list is refused', async () => {
    github.listStatus = 403;
    const res = await candidates();
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
      details: { resetAt: '2030-03-17T17:46:40.000Z' },
    });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('stops politely when the allowance runs out mid-scan: partial, reported, not cached', async () => {
    // After the list call 2 requests are left: the reserve, so nothing more is sent.
    github.rate.remaining = 3;
    const res = await candidates();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      partial: true,
      cached: false,
      rateLimit: { remaining: 2, resetAt: expect.any(String) },
    });
    // Only the repo-list call happened; repos still show what the list itself knows.
    expect(calls).toHaveLength(1);
    expect(res.body.data.repos.map((entry) => entry.repo)).toEqual(['ada/shop']);
    expect(res.body.data.repos[0].candidates[0].source).toBe('homepage');

    // Not cached: the next call scans again.
    github.rate.remaining = 4000;
    const again = await candidates();
    expect(again.body.data).toMatchObject({ partial: false, cached: false });
  });

  it('maps a rejected token to 409 and an unreachable GitHub to 502', async () => {
    const rejected = buildTestApp({
      githubProbe: fakeProbe,
      githubFetch: async () => json({ message: 'Bad credentials' }, 401),
    });
    const user = await registerUser(rejected, { name: 'R' });
    await linkGithub(user);
    const a = await request(rejected)
      .get(`/api/v1/workspaces/${user.workspaceId}/github/candidates`)
      .set(user.auth);
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe('GITHUB_NOT_LINKED');

    const down = buildTestApp({
      githubProbe: fakeProbe,
      githubFetch: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const other = await registerUser(down, { name: 'D' });
    await linkGithub(other);
    const b = await request(down)
      .get(`/api/v1/workspaces/${other.workspaceId}/github/candidates`)
      .set(other.auth);
    expect(b.status).toBe(502);
    expect(b.body.error.code).toBe('GITHUB_UNAVAILABLE');
  });

  it('survives a failing probe and missing README/deployments (a repo is never lost to them)', async () => {
    github.readmes = {};
    github.deployments = {};
    const exploding = buildTestApp({
      githubFetch: fakeGithub,
      githubProbe: async () => {
        throw new Error('boom');
      },
    });
    const user = await registerUser(exploding, { name: 'E' });
    await linkGithub(user);
    const res = await request(exploding)
      .get(`/api/v1/workspaces/${user.workspaceId}/github/candidates`)
      .set(user.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.repos[0].candidates[0]).toMatchObject({
      status: 'down',
      statusCode: null,
    });
  });

  describe('access', () => {
    it('requires a login', async () => {
      expect((await request(app).get(url('/candidates'))).status).toBe(401);
    });

    it('refuses a viewer (403) and a non-member (404)', async () => {
      expect((await candidates(viewer)).status).toBe(403);
      const stranger = await registerUser(app, { name: 'Stranger' });
      await linkGithub(stranger);
      const res = await candidates(stranger);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses a user who did not sign in with GitHub: 409 GITHUB_NOT_LINKED', async () => {
      const plain = await registerUser(app, { name: 'Plain' });
      await request(app)
        .post(`/api/v1/workspaces/${wid}/members`)
        .set(owner.auth)
        .send({ email: plain.user.email, role: 'member' });
      const res = await candidates(plain);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GITHUB_NOT_LINKED');
      expect(calls).toHaveLength(0);
    });

    it('asks for a new sign-in when the identity has no stored token', async () => {
      await User.updateOne({ _id: owner.user.id }, { $unset: { 'identities.$[].tokenEnc': '' } });
      const res = await candidates();
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'GITHUB_NOT_LINKED' });
      expect(res.body.error.message).toMatch(/sign in with github again/i);
    });

    it('treats an undecryptable token (key changed) like a missing one', async () => {
      await User.updateOne(
        { _id: owner.user.id },
        {
          $set: {
            'identities.$[].tokenEnc': createTokenCrypto({
              JWT_REFRESH_SECRET: 'x'.repeat(40),
            }).encrypt('t'),
          },
        },
      );
      expect((await candidates()).body.error.code).toBe('GITHUB_NOT_LINKED');
    });
  });
});

describe('POST /github/import', () => {
  it('creates HTTP monitors with the import defaults, named after the repo, and schedules them', async () => {
    await candidates(); // fills the cache with repo names
    const res = await importUrls({
      urls: ['https://shop-prod.vercel.app/', 'https://site-demo.netlify.app/'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.skipped).toEqual([]);
    expect(res.body.data.created).toEqual([
      expect.objectContaining({ name: 'shop', url: 'https://shop-prod.vercel.app/' }),
      expect.objectContaining({ name: 'site', url: 'https://site-demo.netlify.app/' }),
    ]);
    expect(res.body.data.statusPage).toBeUndefined();

    const monitors = await Monitor.find({ workspaceId: wid }).sort({ createdAt: 1 });
    expect(monitors).toHaveLength(2);
    expect(monitors[0]).toMatchObject({
      name: 'shop',
      type: 'http',
      method: 'HEAD',
      intervalSec: 300,
      currentIntervalSec: 300,
      adaptive: true,
      status: 'pending',
    });
    expect(scheduler.calls).toEqual(
      monitors.map((monitor) => ['schedule', String(monitor._id), 300]),
    );
  });

  it('falls back to the hostname for URLs that were not in the cache', async () => {
    const res = await importUrls({ urls: ['https://some.example.org/app'] });
    expect(res.status).toBe(201);
    expect(res.body.data.created[0].name).toBe('some.example.org');
  });

  it('skips already monitored, duplicate, invalid and blocked URLs and keeps going', async () => {
    const strict = buildTestApp({
      scheduler,
      githubFetch: fakeGithub,
      githubProbe: fakeProbe,
      env: { ALLOW_PRIVATE_TARGETS: false },
    });
    await Monitor.create({
      workspaceId: wid,
      name: 'Existing',
      url: 'https://example.com/',
      intervalSec: 60,
    });
    const res = await importUrls(
      {
        urls: [
          'http://www.example.com', // same site as the existing monitor
          'https://1.1.1.1/', // fine (IP literal, public)
          'https://1.1.1.1', // duplicate within the request
          'not a url',
          'ftp://files.example.com',
          'http://10.0.0.5/', // private: the SSRF guard
        ],
      },
      owner,
      strict,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.created.map((c) => c.url)).toEqual(['https://1.1.1.1/']);
    expect(res.body.data.skipped).toEqual([
      { url: 'http://www.example.com', reason: 'already_monitored' },
      { url: 'https://1.1.1.1', reason: 'already_monitored' },
      { url: 'not a url', reason: 'invalid' },
      { url: 'ftp://files.example.com', reason: 'invalid' },
      { url: 'http://10.0.0.5/', reason: 'blocked' },
    ]);
    expect(await Monitor.countDocuments({ workspaceId: wid })).toBe(2);
  });

  it('validates the body: 1 to 50 URLs, a known status page mode', async () => {
    expect((await importUrls({ urls: [] })).status).toBe(400);
    expect((await importUrls({})).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => `https://s${i}.example.com`);
    expect((await importUrls({ urls: tooMany })).status).toBe(400);
    expect((await importUrls({ urls: tooMany.slice(0, 50) })).status).toBe(201);
    expect(
      (await importUrls({ urls: ['https://a.example.com'], statusPage: { mode: 'merge' } })).status,
    ).toBe(400);
    expect(
      (
        await importUrls({
          urls: ['https://a.example.com'],
          statusPage: { mode: 'extend', id: 'x' },
        })
      ).status,
    ).toBe(400);
  });

  describe('access', () => {
    it('refuses a viewer (403), a non-member (404), a non-GitHub user (409) and anonymous (401)', async () => {
      const body = { urls: ['https://a.example.com'] };
      expect((await importUrls(body, viewer)).status).toBe(403);
      const stranger = await registerUser(app, { name: 'Stranger' });
      await linkGithub(stranger);
      expect((await importUrls(body, stranger)).status).toBe(404);

      const plain = await registerUser(app, { name: 'Plain' });
      await request(app)
        .post(`/api/v1/workspaces/${wid}/members`)
        .set(owner.auth)
        .send({ email: plain.user.email, role: 'member' });
      const res = await importUrls(body, plain);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GITHUB_NOT_LINKED');

      expect((await request(app).post(url('/import')).send(body)).status).toBe(401);
      expect(await Monitor.countDocuments({ workspaceId: wid })).toBe(0);
    });

    it('lets a member import', async () => {
      const member = await registerUser(app, { name: 'Member' });
      await linkGithub(member);
      await request(app)
        .post(`/api/v1/workspaces/${wid}/members`)
        .set(owner.auth)
        .send({ email: member.user.email, role: 'member' });
      expect((await importUrls({ urls: ['https://a.example.com'] }, member)).status).toBe(201);
    });
  });

  describe('status page option', () => {
    it('creates a public page listing the new monitors', async () => {
      await candidates();
      const res = await importUrls({
        urls: ['https://shop-prod.vercel.app/', 'https://site-demo.netlify.app/'],
        statusPage: { mode: 'create', title: 'My projects' },
      });
      expect(res.status).toBe(201);
      const { statusPage, created } = res.body.data;
      expect(statusPage).toMatchObject({ title: 'My projects', added: 2 });
      expect(statusPage.slug).toMatch(/^my-projects-[0-9a-f]{6}$/);

      const page = await StatusPage.findById(statusPage.id);
      expect(page.isPublic).toBe(true);
      expect(page.monitorIds.map(String)).toEqual(created.map((c) => c.id));
      const publicRes = await request(app).get(`/api/v1/public/status/${statusPage.slug}`);
      expect(publicRes.status).toBe(200);
    });

    it('uses a default title when none is given', async () => {
      const res = await importUrls({
        urls: ['https://a.example.com'],
        statusPage: { mode: 'create' },
      });
      expect(res.body.data.statusPage.title).toBe('GitHub projects');
    });

    it('extends an existing page and keeps its monitors', async () => {
      const kept = await Monitor.create({
        workspaceId: wid,
        name: 'Kept',
        url: 'https://kept.example.com',
        intervalSec: 60,
      });
      const page = await StatusPage.create({
        workspaceId: wid,
        slug: 'existing-page',
        title: 'Existing',
        monitorIds: [kept._id],
      });
      const res = await importUrls({
        urls: ['https://a.example.com', 'https://b.example.com'],
        statusPage: { mode: 'extend', id: String(page._id) },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.statusPage).toEqual({
        id: String(page._id),
        slug: 'existing-page',
        title: 'Existing',
        added: 2,
      });
      const updated = await StatusPage.findById(page._id);
      expect(updated.monitorIds.map(String)).toEqual([
        String(kept._id),
        ...res.body.data.created.map((c) => c.id),
      ]);
    });

    it('fails before creating anything for an unknown or full page', async () => {
      const unknown = await importUrls({
        urls: ['https://a.example.com'],
        statusPage: { mode: 'extend', id: new mongoose.Types.ObjectId().toString() },
      });
      expect(unknown.status).toBe(404);

      const full = await StatusPage.create({
        workspaceId: wid,
        slug: 'full-page',
        title: 'Full',
        monitorIds: Array.from({ length: 50 }, () => new mongoose.Types.ObjectId()),
      });
      const tooFull = await importUrls({
        urls: ['https://a.example.com'],
        statusPage: { mode: 'extend', id: String(full._id) },
      });
      expect(tooFull.status).toBe(400);
      expect(await Monitor.countDocuments({ workspaceId: wid })).toBe(0);
    });

    it('does not touch a page of another workspace', async () => {
      const other = await registerUser(app, { name: 'Other' });
      const foreign = await StatusPage.create({
        workspaceId: other.workspaceId,
        slug: 'foreign-page',
        title: 'Foreign',
      });
      const res = await importUrls({
        urls: ['https://a.example.com'],
        statusPage: { mode: 'extend', id: String(foreign._id) },
      });
      expect(res.status).toBe(404);
    });

    it('creates no page when every URL was skipped', async () => {
      const res = await importUrls({ urls: ['nope'], statusPage: { mode: 'create' } });
      expect(res.body.data.statusPage).toBeUndefined();
      expect(await StatusPage.countDocuments({ workspaceId: wid })).toBe(0);
    });
  });
});

describe('GitHub token at rest', () => {
  const credentials = { GITHUB_CLIENT_ID: 'github-id', GITHUB_CLIENT_SECRET: 'github-secret' };
  let grantedToken;
  let tokenScope;

  const oauthFetch = async (target) => {
    const { pathname } = new URL(target);
    if (pathname === '/login/oauth/access_token') {
      return json({ access_token: grantedToken, token_type: 'bearer', scope: tokenScope });
    }
    if (pathname === '/user') return json({ id: 77, login: 'ada', name: 'Ada' });
    if (pathname === '/user/emails') {
      return json([{ email: 'ada@example.com', primary: true, verified: true }]);
    }
    throw new Error(`unexpected ${target}`);
  };
  const oauthApp = buildTestApp({ env: credentials, oauthFetch, scheduler });

  async function githubSignIn() {
    const start = await request(oauthApp).get('/api/v1/auth/oauth/github/start');
    const state = new URL(start.headers.location).searchParams.get('state');
    const cookie = start.headers['set-cookie'].find((c) => c.startsWith('pb_oauth=')).split(';')[0];
    const res = await request(oauthApp)
      .get('/api/v1/auth/oauth/github/callback')
      .query({ code: 'c', state })
      .set('Cookie', cookie);
    expect(new URL(res.headers.location).searchParams.get('status')).toBe('ok');
    return res;
  }

  it('stores the token encrypted with the login and scope, overwritten at each sign-in', async () => {
    grantedToken = 'gho_first_token';
    tokenScope = 'read:user,user:email';
    const first = await githubSignIn();

    const user = await User.findOne({ email: 'ada@example.com' }).lean();
    const identity = user.identities[0];
    expect(identity).toMatchObject({ provider: 'github', login: 'ada', tokenScope });
    expect(identity.tokenUpdatedAt).toBeInstanceOf(Date);
    expect(identity.tokenEnc).toMatch(/^v1\./);
    expect(identity.tokenEnc).not.toContain('gho_first_token');
    expect(JSON.stringify(user)).not.toContain('gho_first_token');
    expect(crypto.decrypt(identity.tokenEnc)).toBe('gho_first_token');

    // Never in a response: /auth/me (the user's JSON) carries neither token nor identities.
    const refreshed = await request(oauthApp)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(first));
    const me = await request(oauthApp)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.body.data.user.providers).toEqual(['github']);
    expect(JSON.stringify(me.body)).not.toMatch(/tokenEnc|tokenScope|gho_first_token|identities/);

    // A second sign-in replaces it.
    grantedToken = 'gho_second_token';
    await githubSignIn();
    const again = (await User.findOne({ email: 'ada@example.com' }).lean()).identities[0];
    expect(again.tokenEnc).not.toBe(identity.tokenEnc);
    expect(crypto.decrypt(again.tokenEnc)).toBe('gho_second_token');
  });

  it('works end to end: a GitHub sign-in is enough for candidates', async () => {
    grantedToken = TOKEN;
    tokenScope = 'read:user,user:email';
    const session = await githubSignIn();
    const refreshed = await request(oauthApp)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(session));
    const auth = { Authorization: `Bearer ${refreshed.body.data.accessToken}` };
    const me = await request(oauthApp).get('/api/v1/auth/me').set(auth);

    const e2e = buildTestApp({
      githubFetch: fakeGithub,
      githubProbe: fakeProbe,
      env: credentials,
      oauthFetch,
    });
    const res = await request(e2e)
      .get(`/api/v1/workspaces/${me.body.data.workspaces[0].id}/github/candidates`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.githubLogin).toBe('ada');
  });
});

describe('tokenCrypto', () => {
  it('round-trips, uses a fresh IV each time, and rejects tampering or another key', () => {
    const a = crypto.encrypt('secret');
    const b = crypto.encrypt('secret');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('secret');

    const [v, iv, tag, data] = a.split('.');
    const flipped = `${v}.${iv}.${tag}.${Buffer.from(data, 'base64url')
      .map((x) => x ^ 1)
      .toString('base64url')}`;
    expect(crypto.decrypt(flipped)).toBeNull();
    expect(crypto.decrypt('garbage')).toBeNull();
    expect(crypto.decrypt(undefined)).toBeNull();

    const other = createTokenCrypto({ ...testEnv, GITHUB_TOKEN_ENCRYPTION_KEY: 'k'.repeat(40) });
    expect(other.decrypt(a)).toBeNull();
    expect(other.decrypt(other.encrypt('secret'))).toBe('secret');
  });
});
