import { extractReadmeCandidates, isExcludedUrl, normalizeUrl, urlKey } from './extract.js';

/** Best first: a deployment URL is the strongest evidence the site really exists. */
export const SOURCE_RANK = Object.freeze({ deployment: 0, homepage: 1, pages: 2, readme: 3 });

/** Candidates kept per repo, so one noisy README cannot dominate the probe budget. */
export const MAX_CANDIDATES_PER_REPO = 4;

/**
 * Merges the URL sources of one repo into a normalised, deduped, ranked list
 * of { url, source }. When the same site shows up from several sources the
 * best-ranked source wins.
 *
 * @param sources { homepage, pagesUrl, deploymentUrls: string[], readme: string }
 */
export function collectCandidates({
  homepage,
  pagesUrl,
  deploymentUrls = [],
  readme,
  max = MAX_CANDIDATES_PER_REPO,
} = {}) {
  const raw = [
    ...deploymentUrls.map((url) => ({ url, source: 'deployment' })),
    { url: homepage, source: 'homepage' },
    { url: pagesUrl, source: 'pages' },
    ...extractReadmeCandidates(readme).map((url) => ({ url, source: 'readme' })),
  ];
  const bySite = new Map();
  for (const { url, source } of raw) {
    const normalized = normalizeUrl(url);
    if (!normalized || isExcludedUrl(normalized)) continue;
    const key = urlKey(normalized);
    const existing = bySite.get(key);
    if (!existing || SOURCE_RANK[source] < SOURCE_RANK[existing.source]) {
      bySite.set(key, { url: normalized, source });
    }
  }
  return [...bySite.values()]
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.url.localeCompare(b.url))
    .slice(0, max);
}

const siteOf = (url) => ({
  host: url.hostname.replace(/^www\./, ''),
  path: url.pathname.replace(/\/+$/, ''),
});

/**
 * live: answered and ended on the same site; redirect: answered but ended on
 * another host or path; down: error, timeout, SSRF block, or a 4xx/5xx.
 *
 * @param probe { ok, statusCode, finalUrl } as returned by runHttpCheck
 */
export function classifyProbe(candidateUrl, probe) {
  const statusCode = probe?.statusCode ?? null;
  if (!probe?.ok || statusCode === null || statusCode >= 400) return { status: 'down', statusCode };
  let finalUrl;
  try {
    finalUrl = new URL(probe.finalUrl ?? candidateUrl);
  } catch {
    return { status: 'live', statusCode };
  }
  const from = siteOf(new URL(candidateUrl));
  const to = siteOf(finalUrl);
  return {
    status: from.host === to.host && from.path === to.path ? 'live' : 'redirect',
    statusCode,
  };
}
