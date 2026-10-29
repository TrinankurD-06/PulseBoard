import { runHttpCheck } from '@pulseboard/shared/check';
import { appUrlOf } from '@pulseboard/shared/env';
import { Monitor, User } from '@pulseboard/shared/models';
import { classifyProbe, collectCandidates, urlKey } from '@pulseboard/shared/github';
import { AppError } from '../../lib/errors.js';
import { createTokenCrypto } from '../../lib/tokenCrypto.js';
import { createTtlCache } from '../../lib/ttlCache.js';
import { uniqueSlug } from '../../lib/slug.js';
import { createMonitorService } from '../monitors/monitors.service.js';
import { createStatusPageService } from '../statusPages/statusPages.service.js';
import { createGithubClient } from './githubClient.js';

export const CACHE_TTL_MS = 10 * 60 * 1000;
// Most recently pushed repos only: each costs a few GitHub requests.
export const MAX_REPOS = 60;
const REPO_PAGES = 3; // x 100 per page, before filtering
export const MAX_PROBES = 120;
const GITHUB_CONCURRENCY = 6;
const PROBE_CONCURRENCY = 10;
const PROBE_TIMEOUT_MS = 5000;
const MAX_README_CHARS = 200_000;
const MAX_ENVIRONMENTS = 2;

// What a repo's monitor looks like when imported (the contract with the client).
const IMPORT_DEFAULTS = { intervalSec: 300, method: 'HEAD', adaptive: true };

const notLinked = (message) => new AppError(409, 'GITHUB_NOT_LINKED', message);
const SIGN_IN_AGAIN = 'Sign in with GitHub again to allow importing your repositories.';

/** Runs `task` over `items` with at most `limit` in flight; results keep the input order. */
async function mapPool(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * "Import from GitHub": finds the live sites behind a user's public repos
 * (deterministic: GitHub metadata and README links, no AI) and turns the
 * chosen ones into monitors.
 *
 * `fetchImpl` (GitHub) and `probe` (the reachability check) are injectable.
 * Scan results are cached in this process for 10 minutes per user + forks flag.
 */
export function createGithubService({
  env,
  scheduler,
  schemas,
  publicCache,
  fetchImpl = globalThis.fetch,
  probe,
  now = Date.now,
  cacheTtlMs = CACHE_TTL_MS,
}) {
  const crypto = createTokenCrypto(env);
  const monitors = createMonitorService({ env, scheduler, schemas });
  const statusPages = createStatusPageService({ publicCache });
  const cache = createTtlCache({ ttlMs: cacheTtlMs, maxEntries: 200, now });
  const inflight = new Map();

  // HEAD, 5 s, the same runner (and SSRF guard) as real checks.
  const runProbe =
    probe ??
    ((url) =>
      runHttpCheck(
        {
          url,
          method: 'HEAD',
          timeoutMs: PROBE_TIMEOUT_MS,
          expectedStatus: { min: 200, max: 399 },
        },
        { allowPrivate: env.ALLOW_PRIVATE_TARGETS, appUrl: appUrlOf(env) },
      ));

  const cacheKey = (userId, forks) => `${userId}:${forks ? 'forks' : 'own'}`;

  async function githubIdentityOf(userId) {
    const user = await User.findById(userId).select('identities');
    const identity = user?.identities?.find((item) => item.provider === 'github');
    if (!identity) throw notLinked(`This account is not linked to GitHub. ${SIGN_IN_AGAIN}`);
    return identity;
  }

  /** Lists the user's public repos and finds, then probes, their candidate URLs. */
  async function scan(identity, { forks }) {
    const accessToken = identity.tokenEnc ? crypto.decrypt(identity.tokenEnc) : null;
    if (!accessToken) throw notLinked(SIGN_IN_AGAIN);
    const client = createGithubClient({ fetch: fetchImpl, token: accessToken, now });

    const login = identity.login || (await client.request('/user')).data?.login;
    if (!login) throw notLinked(SIGN_IN_AGAIN);

    // 1. Public repos, most recently pushed first. A rate limit here is fatal (429).
    const found = [];
    for (let page = 1; page <= REPO_PAGES; page += 1) {
      const result = await client.request(
        `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100&page=${page}`,
      );
      if (!Array.isArray(result.data)) break;
      found.push(...result.data);
      if (!result.hasNext || result.data.length === 0) break;
    }
    const repos = found
      .filter((repo) => !repo.archived && !repo.disabled && !repo.private && (forks || !repo.fork))
      .slice(0, MAX_REPOS);

    // 2. Per repo: homepage, Pages, latest deployments, README. Running out of
    //    GitHub requests stops the scan politely and returns what we have.
    let exhausted = false;
    const guarded = async (call) => {
      if (exhausted) return null;
      try {
        return await call();
      } catch (err) {
        if (err instanceof AppError && err.code === 'GITHUB_RATE_LIMITED') {
          exhausted = true;
          return null;
        }
        throw err;
      }
    };

    const enriched = await mapPool(repos, GITHUB_CONCURRENCY, async (repo) => {
      const full = `/repos/${repo.full_name}`;
      const pages = repo.has_pages
        ? await guarded(() => client.request(`${full}/pages`, { optional: true }))
        : null;
      const deployments = await guarded(() =>
        client.request(`${full}/deployments?per_page=10`, { optional: true }),
      );
      const deploymentUrls = [];
      if (Array.isArray(deployments?.data)) {
        // Newest first: the first deployment of each environment is its latest.
        const latest = new Map();
        for (const deployment of deployments.data) {
          const envName = String(deployment.environment ?? '');
          if (/preview/i.test(envName) || latest.has(envName)) continue;
          latest.set(envName, deployment);
        }
        for (const deployment of [...latest.values()].slice(0, MAX_ENVIRONMENTS)) {
          const statuses = await guarded(() =>
            client.request(`${full}/deployments/${deployment.id}/statuses?per_page=1`, {
              optional: true,
            }),
          );
          const url = Array.isArray(statuses?.data) ? statuses.data[0]?.environment_url : null;
          if (url) deploymentUrls.push(url);
        }
      }
      const readme = await guarded(() =>
        client.request(`${full}/readme`, { raw: true, optional: true }),
      );
      return {
        repo,
        candidates: collectCandidates({
          homepage: repo.homepage,
          pagesUrl: pages?.data?.html_url,
          deploymentUrls,
          readme: typeof readme?.data === 'string' ? readme.data.slice(0, MAX_README_CHARS) : '',
        }),
      };
    });

    // 3. Probe, under a global cap so a big account cannot turn into a crawl.
    let budget = MAX_PROBES;
    const withCandidates = [];
    for (const item of enriched) {
      if (budget <= 0) break;
      const candidates = item.candidates.slice(0, budget);
      budget -= candidates.length;
      if (candidates.length) withCandidates.push({ ...item, candidates });
    }
    const flat = withCandidates.flatMap((item) => item.candidates.map((c) => ({ item, c })));
    const probed = await mapPool(flat, PROBE_CONCURRENCY, async ({ c }) => {
      let result;
      try {
        result = await runProbe(c.url);
      } catch {
        result = { ok: false, statusCode: null };
      }
      const { status, statusCode } = classifyProbe(c.url, result);
      return {
        url: c.url,
        finalUrl: result?.finalUrl ?? c.url,
        source: c.source,
        status,
        statusCode,
      };
    });

    const byRepo = new Map(withCandidates.map((item) => [item.repo.full_name, []]));
    flat.forEach(({ item }, index) => byRepo.get(item.repo.full_name).push(probed[index]));

    return {
      githubLogin: login,
      fetchedAt: new Date(now()).toISOString(),
      rateLimit: client.rateLimit,
      partial: exhausted,
      repos: withCandidates.map(({ repo }) => ({
        repo: repo.full_name,
        name: repo.name,
        htmlUrl: repo.html_url,
        isFork: Boolean(repo.fork),
        candidates: byRepo.get(repo.full_name),
      })),
    };
  }

  /** Marks which candidates the workspace already monitors (compared by normalised URL). */
  async function monitoredKeys(workspaceId) {
    const existing = await Monitor.find({ workspaceId, url: { $type: 'string' } }).select('url');
    const keys = new Map();
    for (const monitor of existing) {
      const key = urlKey(monitor.url);
      if (key) keys.set(key, String(monitor._id));
    }
    return keys;
  }

  /** Repo name for a URL from this user's cached scans (either forks setting). */
  function cachedRepoNames(userId) {
    const names = new Map();
    for (const forks of [false, true]) {
      const hit = cache.get(cacheKey(userId, forks));
      if (!hit.hit) continue;
      for (const repo of hit.value.repos) {
        for (const c of repo.candidates) {
          for (const url of [c.url, c.finalUrl]) {
            const key = urlKey(url);
            if (key && !names.has(key)) names.set(key, repo.name);
          }
        }
      }
    }
    return names;
  }

  return {
    async candidates(workspaceId, userId, { forks = false } = {}) {
      const identity = await githubIdentityOf(userId);
      const key = cacheKey(userId, forks);

      let scanned = cache.get(key);
      let cached = scanned.hit;
      if (!scanned.hit) {
        // Two clicks at once share one scan instead of spending the rate limit twice.
        let pending = inflight.get(key);
        if (!pending) {
          pending = scan(identity, { forks })
            .then((result) => {
              if (!result.partial) cache.set(key, result);
              return result;
            })
            .finally(() => inflight.delete(key));
          inflight.set(key, pending);
        }
        scanned = { value: await pending };
        cached = false;
      }

      const taken = await monitoredKeys(workspaceId);
      const { partial, ...rest } = scanned.value;
      return {
        ...rest,
        cached,
        partial,
        repos: rest.repos.map((repo) => ({
          ...repo,
          candidates: repo.candidates.map((candidate) => {
            const monitorId =
              taken.get(urlKey(candidate.url)) ?? taken.get(urlKey(candidate.finalUrl));
            return { ...candidate, monitored: Boolean(monitorId), ...(monitorId && { monitorId }) };
          }),
        })),
      };
    },

    async importUrls(workspaceId, userId, { urls, statusPage }) {
      await githubIdentityOf(userId);
      const names = cachedRepoNames(userId);
      const taken = await monitoredKeys(workspaceId);

      const skipped = [];
      const toCreate = [];
      const seen = new Set();
      for (const url of urls) {
        const key = urlKey(url);
        if (key && (taken.has(key) || seen.has(key))) {
          skipped.push({ url, reason: 'already_monitored' });
          continue;
        }
        const name = (key && names.get(key)) || safeHostname(url);
        // The normal create schema: same rules as the monitor form.
        const parsed = schemas.create.safeParse({ ...IMPORT_DEFAULTS, name, url });
        if (!parsed.success) {
          skipped.push({ url, reason: 'invalid' });
          continue;
        }
        seen.add(key);
        toCreate.push(parsed.data);
      }

      // Fail before creating anything when an existing page cannot take them all.
      let page = null;
      if (statusPage?.mode === 'extend') {
        page = await statusPages.findInWorkspace(workspaceId, statusPage.id);
        if (page.monitorIds.length + toCreate.length > 50) {
          throw new AppError(400, 'BAD_REQUEST', 'A status page can list at most 50 monitors', [
            { path: 'statusPage', message: 'Too many monitors for this status page' },
          ]);
        }
      }

      const created = [];
      for (const input of toCreate) {
        try {
          const monitor = await monitors.create(workspaceId, input);
          created.push({ id: String(monitor._id), name: monitor.name, url: monitor.url });
        } catch (err) {
          // The SSRF guard (private addresses): skip this URL, keep importing the rest.
          if (err instanceof AppError && err.code === 'UNSAFE_TARGET') {
            skipped.push({ url: input.url, reason: 'blocked' });
            continue;
          }
          throw err;
        }
      }

      const result = { created, skipped };
      if (statusPage && created.length) {
        const ids = created.map((monitor) => monitor.id);
        if (statusPage.mode === 'extend') {
          const updated = await statusPages.update(workspaceId, page.id, {
            monitorIds: [...page.monitorIds.map(String), ...ids],
          });
          result.statusPage = pageDto(updated, ids.length);
        } else {
          const title = statusPage.title ?? 'GitHub projects';
          result.statusPage = pageDto(await createPage(workspaceId, title, ids), ids.length);
        }
      }
      return result;
    },
  };

  /** A fresh random suffix on the slug; retried in the unlikely event it is taken. */
  async function createPage(workspaceId, title, monitorIds) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await statusPages.create(workspaceId, {
          title,
          slug: uniqueSlug(title),
          description: '',
          monitorIds,
          isPublic: true,
        });
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'CONFLICT') || attempt >= 2) throw err;
      }
    }
  }
}

const pageDto = (page, added) => ({
  id: String(page._id),
  slug: page.slug,
  title: page.title,
  added,
});

function safeHostname(url) {
  try {
    return new URL(url).hostname.slice(0, 100);
  } catch {
    return url.slice(0, 100);
  }
}
