// Hosting platforms whose URLs in a README usually point at a deployed app.
export const HOSTING_DOMAINS = Object.freeze([
  'vercel.app',
  'netlify.app',
  'onrender.com',
  'github.io',
  'herokuapp.com',
  'pages.dev',
  'fly.dev',
  'railway.app',
]);

// Links whose text says "this is the running thing".
const LABEL = /\b(demo|live|website)\b/i;

// Never worth monitoring: code hosting, badge services, image hosts.
const EXCLUDED_HOSTS = [
  'github.com',
  'githubusercontent.com',
  'githubassets.com',
  'shields.io',
  'badgen.net',
  'badge.fury.io',
  'codecov.io',
  'coveralls.io',
  'travis-ci.org',
  'travis-ci.com',
  'circleci.com',
  'img.youtube.com',
  'imgur.com',
  'gravatar.com',
  'opencollective.com',
];

const IMAGE_PATH = /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i;

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** The hosting platform a host belongs to, or null. */
export const hostingDomainOf = (host) =>
  HOSTING_DOMAINS.find((domain) => hostMatches(host, domain)) ?? null;

/**
 * Canonical form of an http(s) URL: lowercase host, no fragment, no default
 * port (URL handles that), trailing slash dropped except for the bare root.
 * Returns null for anything that is not an http(s) URL.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

/**
 * What makes two URLs "the same site" when comparing: host (minus a leading
 * www.), path without trailing slash, query. The scheme is ignored, because
 * http:// almost always redirects to https:// and is the same monitor target.
 */
export function urlKey(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  const path = url.pathname.replace(/\/+$/, '');
  const port = url.port ? `:${url.port}` : '';
  return `${url.hostname.replace(/^www\./, '')}${port}${path}${url.search}`;
}

/** True for URLs that must never be offered: code host, badges, images, localhost. */
export function isExcludedUrl(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return true;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^(127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(host)) return true;
  if (EXCLUDED_HOSTS.some((domain) => hostMatches(host, domain))) return true;
  if (/^(img|badge|badges)\./.test(host)) return true;
  if (IMAGE_PATH.test(url.pathname)) return true;
  if (/\/badges?(\/|$)/i.test(url.pathname)) return true;
  return false;
}

const stripTags = (html) => html.replace(/<[^>]*>/g, ' ');
const cleanUrl = (raw) =>
  raw
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/[.,;:!?'"]+$/, '');

/**
 * Every link in a README as { url, label }: Markdown links, <a href> tags,
 * reference definitions and bare URLs. Images (![alt](src), <img>) are not
 * links, but a badge that wraps an image in a link keeps its target.
 */
export function extractLinks(markdown) {
  if (typeof markdown !== 'string' || !markdown) return [];
  const links = [];
  let text = markdown
    // Fenced code: example URLs in snippets are not links to the project.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

  // <a href="...">label</a>
  text = text.replace(
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, inner) => {
      links.push({ url: cleanUrl(href), label: stripTags(inner).trim() });
      return ' ';
    },
  );
  // [label](url "title")
  text = text.replace(
    /\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
    (_, label, href) => {
      links.push({ url: cleanUrl(href), label: label.trim() });
      return ' ';
    },
  );
  // [label]: url (reference definitions)
  text = text.replace(/^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm, (_, label, href) => {
    links.push({ url: cleanUrl(href), label: label.trim() });
    return ' ';
  });
  // Bare and <autolinked> URLs.
  for (const match of text.matchAll(/https?:\/\/[^\s<>()"'\]]+/g)) {
    links.push({ url: cleanUrl(match[0]), label: '' });
  }
  return links.filter((link) => /^https?:\/\//i.test(link.url));
}

/**
 * The README links worth probing: they sit on a known hosting platform, or
 * are labelled "demo", "live" or "website". Excluded URLs are dropped. The
 * result is normalised and deduped by site.
 */
export function extractReadmeCandidates(markdown) {
  const seen = new Set();
  const urls = [];
  for (const { url, label } of extractLinks(markdown)) {
    const normalized = normalizeUrl(url);
    if (!normalized || isExcludedUrl(normalized)) continue;
    const host = new URL(normalized).hostname.toLowerCase();
    if (!hostingDomainOf(host) && !LABEL.test(label)) continue;
    const key = urlKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(normalized);
  }
  return urls;
}
