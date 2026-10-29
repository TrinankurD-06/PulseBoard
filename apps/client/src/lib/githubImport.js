// Pure helpers for the "Import from GitHub" review screen. The server returns
// candidate sites per repo; these decide what is selectable, what is selected
// by default, how the Import button reads and how errors are worded.

/** The server accepts at most this many URLs per import request. */
export const MAX_IMPORT_URLS = 50;

const STATUS_ORDER = { live: 0, redirect: 1, down: 2 };
const SOURCE_ORDER = { deployment: 0, homepage: 1, pages: 2, readme: 3 };

export const STATUS_INFO = {
  live: { label: 'Live', tone: 'green' },
  redirect: { label: 'Redirect', tone: 'amber' },
  down: { label: 'Down', tone: 'red' },
};

export const SOURCE_LABELS = {
  deployment: 'Deployment',
  homepage: 'Homepage',
  pages: 'Pages',
  readme: 'README',
};

/** { label, tone } for a candidate status; unknown values read as Down. */
export function statusInfo(status) {
  return STATUS_INFO[status] ?? STATUS_INFO.down;
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? 'Link';
}

/** Where a candidate redirected to, or null when it didn't (or the target is unknown). */
export function redirectTarget(candidate) {
  if (candidate.status !== 'redirect') return null;
  return candidate.finalUrl && candidate.finalUrl !== candidate.url ? candidate.finalUrl : null;
}

/** A candidate can be ticked unless it is already a monitor. Down ones are allowed. */
export function isSelectable(candidate) {
  return !candidate.monitored;
}

/**
 * Repos sorted by name, each with its candidates sorted live, redirect, down and
 * then by source; repos without candidates are dropped. Inputs aren't mutated.
 */
export function groupRepos(repos = []) {
  return repos
    .filter((repo) => repo.candidates?.length > 0)
    .map((repo) => ({
      ...repo,
      candidates: [...repo.candidates].sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
          (SOURCE_ORDER[a.source] ?? 4) - (SOURCE_ORDER[b.source] ?? 4) ||
          a.url.localeCompare(b.url),
      ),
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

/** Every distinct URL that can be selected, in display order. */
export function selectableUrls(repos = []) {
  const urls = new Set();
  for (const repo of repos) {
    for (const candidate of repo.candidates) if (isSelectable(candidate)) urls.add(candidate.url);
  }
  return [...urls];
}

/** What is ticked when the list first appears: everything selectable that isn't down. */
export function defaultSelection(repos = []) {
  const urls = new Set();
  for (const repo of repos) {
    for (const candidate of repo.candidates) {
      if (isSelectable(candidate) && candidate.status !== 'down') urls.add(candidate.url);
    }
  }
  return urls;
}

/** 'all' | 'some' | 'none', ignoring selected URLs that are no longer selectable. */
export function selectAllState(selected, repos) {
  const selectable = selectableUrls(repos);
  if (selectable.length === 0) return 'none';
  const count = selectable.filter((url) => selected.has(url)).length;
  if (count === 0) return 'none';
  return count === selectable.length ? 'all' : 'some';
}

/** The next selection after "Select all": clear when everything is ticked, else tick everything. */
export function toggleSelectAll(selected, repos) {
  return selectAllState(selected, repos) === 'all' ? new Set() : new Set(selectableUrls(repos));
}

export function toggleUrl(selected, url) {
  const next = new Set(selected);
  if (next.has(url)) next.delete(url);
  else next.add(url);
  return next;
}

/** Tick or untick every selectable candidate of one repo. */
export function toggleRepo(selected, repo) {
  const urls = repo.candidates.filter(isSelectable).map((candidate) => candidate.url);
  const next = new Set(selected);
  const allOn = urls.length > 0 && urls.every((url) => next.has(url));
  for (const url of urls) {
    if (allOn) next.delete(url);
    else next.add(url);
  }
  return next;
}

/** Selected URLs that still exist as selectable candidates (a refresh may drop some). */
export function selectedUrls(selected, repos) {
  return selectableUrls(repos).filter((url) => selected.has(url));
}

export function isOverLimit(count) {
  return count > MAX_IMPORT_URLS;
}

/** "Import 3 monitors", "Import 1 monitor", or just "Import" when nothing is ticked. */
export function importLabel(count) {
  if (!count) return 'Import';
  return `Import ${count} monitor${count === 1 ? '' : 's'}`;
}

/** { total, live, redirect, down, monitored } over every candidate. */
export function countCandidates(repos = []) {
  const counts = { total: 0, live: 0, redirect: 0, down: 0, monitored: 0 };
  for (const repo of repos) {
    for (const candidate of repo.candidates) {
      counts.total += 1;
      if (candidate.monitored) counts.monitored += 1;
      else if (counts[candidate.status] !== undefined) counts[candidate.status] += 1;
    }
  }
  return counts;
}

/** The request body for POST /github/import. `statusPage` is { mode, ... } or null. */
export function buildImportBody(urls, statusPage) {
  const body = { urls: urls.slice(0, MAX_IMPORT_URLS) };
  if (statusPage?.mode === 'create') {
    const title = statusPage.title?.trim();
    body.statusPage = title ? { mode: 'create', title } : { mode: 'create' };
  } else if (statusPage?.mode === 'extend' && statusPage.id) {
    body.statusPage = { mode: 'extend', id: statusPage.id };
  }
  return body;
}

export const SKIP_REASONS = {
  already_monitored: 'Already monitored',
  invalid: 'Not a valid URL',
  blocked: 'Blocked (private or unsafe address)',
};

export function skipReason(reason) {
  return SKIP_REASONS[reason] ?? 'Skipped';
}

/** "in 12 minutes" / "in 40 seconds" until `resetAt`, or null without a usable time. */
export function formatRetryIn(resetAt, now = Date.now()) {
  const time = resetAt ? new Date(resetAt).getTime() : NaN;
  if (Number.isNaN(time)) return null;
  const seconds = Math.max(0, Math.ceil((time - now) / 1000));
  if (seconds < 60) return seconds <= 1 ? 'in a moment' : `in ${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Maps a failed request to { code, title, message, action } for the error panel.
 * `action` is 'signin' (start GitHub OAuth again), 'retry' or null.
 */
export function githubErrorInfo(error, now = Date.now()) {
  const body = error?.response?.data?.error;
  const code = body?.code ?? (error?.response ? 'UNKNOWN' : 'NETWORK');
  switch (code) {
    case 'GITHUB_NOT_LINKED':
      return {
        code,
        title: 'Connect your GitHub account',
        message:
          'We need to see your GitHub account to find your sites. Sign in with GitHub to continue.',
        action: 'signin',
      };
    case 'GITHUB_RATE_LIMITED': {
      const when = formatRetryIn(body?.resetAt ?? body?.details?.resetAt, now);
      return {
        code,
        title: 'GitHub is rate limiting us',
        message: when
          ? `GitHub allows only so many requests per hour. Try again ${when}.`
          : 'GitHub allows only so many requests per hour. Try again in a little while.',
        action: 'retry',
      };
    }
    case 'GITHUB_UNAVAILABLE':
      return {
        code,
        title: 'GitHub is unavailable',
        message: "We couldn't reach GitHub just now. Try again in a minute.",
        action: 'retry',
      };
    case 'FORBIDDEN':
      return {
        code,
        title: 'Not allowed',
        message: 'Only workspace members and above can import monitors.',
        action: null,
      };
    case 'NETWORK':
      return {
        code,
        title: "Can't reach the server",
        message: 'Check your connection and try again.',
        action: 'retry',
      };
    default:
      return {
        code,
        title: 'Something went wrong',
        message: body?.message ?? 'Something went wrong. Please try again.',
        action: 'retry',
      };
  }
}
