import { describe, expect, it } from 'vitest';
import {
  buildImportBody,
  countCandidates,
  defaultSelection,
  formatRetryIn,
  githubErrorInfo,
  groupRepos,
  importLabel,
  isOverLimit,
  MAX_IMPORT_URLS,
  redirectTarget,
  selectableUrls,
  selectAllState,
  selectedUrls,
  sourceLabel,
  statusInfo,
  toggleRepo,
  toggleSelectAll,
  toggleUrl,
} from './githubImport.js';

const c = (url, status = 'live', extra = {}) => ({
  url,
  finalUrl: url,
  source: 'homepage',
  status,
  statusCode: 200,
  monitored: false,
  ...extra,
});

const repos = [
  { repo: 'me/zeta', candidates: [c('https://z.dev', 'down')] },
  { repo: 'me/empty', candidates: [] },
  {
    repo: 'me/alpha',
    candidates: [
      c('https://a-down.dev', 'down'),
      c('https://a-readme.dev', 'live', { source: 'readme' }),
      c('https://a-deploy.dev', 'live', { source: 'deployment' }),
      c('https://a-mon.dev', 'live', { monitored: true, monitorId: 'm1' }),
      c('https://a-redir.dev', 'redirect', { finalUrl: 'https://other.dev/x' }),
    ],
  },
];

describe('groupRepos', () => {
  const grouped = groupRepos(repos);
  it('drops empty repos and sorts by name', () => {
    expect(grouped.map((r) => r.repo)).toEqual(['me/alpha', 'me/zeta']);
  });
  it('sorts candidates by status then source, without mutating the input', () => {
    expect(grouped[0].candidates.map((x) => x.url)).toEqual([
      'https://a-deploy.dev',
      'https://a-mon.dev',
      'https://a-readme.dev',
      'https://a-redir.dev',
      'https://a-down.dev',
    ]);
    expect(repos[2].candidates[0].url).toBe('https://a-down.dev');
  });
  it('handles undefined', () => {
    expect(groupRepos()).toEqual([]);
  });
});

describe('selection', () => {
  const grouped = groupRepos(repos);
  it('selectable excludes monitored ones but includes down', () => {
    expect(selectableUrls(grouped)).not.toContain('https://a-mon.dev');
    expect(selectableUrls(grouped)).toContain('https://a-down.dev');
    expect(selectableUrls(grouped)).toHaveLength(5);
  });
  it('default selection skips down and monitored', () => {
    expect([...defaultSelection(grouped)].sort()).toEqual([
      'https://a-deploy.dev',
      'https://a-readme.dev',
      'https://a-redir.dev',
    ]);
  });
  it('reports none, some and all', () => {
    expect(selectAllState(new Set(), grouped)).toBe('none');
    expect(selectAllState(defaultSelection(grouped), grouped)).toBe('some');
    expect(selectAllState(new Set(selectableUrls(grouped)), grouped)).toBe('all');
    expect(selectAllState(new Set(['https://a-mon.dev']), grouped)).toBe('none');
    expect(selectAllState(new Set(), [])).toBe('none');
  });
  it('select all ticks everything, then clears', () => {
    const all = toggleSelectAll(defaultSelection(grouped), grouped);
    expect(all.size).toBe(5);
    expect(toggleSelectAll(all, grouped).size).toBe(0);
  });
  it('toggles one url and one repo', () => {
    const one = toggleUrl(new Set(), 'https://z.dev');
    expect(one.has('https://z.dev')).toBe(true);
    expect(toggleUrl(one, 'https://z.dev').size).toBe(0);
    const repo = toggleRepo(new Set(), grouped[0]);
    expect(repo.size).toBe(4);
    expect(toggleRepo(repo, grouped[0]).size).toBe(0);
  });
  it('selectedUrls drops stale and monitored urls', () => {
    const picked = new Set(['https://gone.dev', 'https://a-mon.dev', 'https://z.dev']);
    expect(selectedUrls(picked, grouped)).toEqual(['https://z.dev']);
  });
});

describe('counts and limits', () => {
  it('labels the import button', () => {
    expect(importLabel(0)).toBe('Import');
    expect(importLabel(1)).toBe('Import 1 monitor');
    expect(importLabel(3)).toBe('Import 3 monitors');
  });
  it('flags more than 50 urls', () => {
    expect(isOverLimit(MAX_IMPORT_URLS)).toBe(false);
    expect(isOverLimit(MAX_IMPORT_URLS + 1)).toBe(true);
  });
  it('counts candidates by state', () => {
    expect(countCandidates(groupRepos(repos))).toEqual({
      total: 6,
      live: 2,
      redirect: 1,
      down: 2,
      monitored: 1,
    });
  });
});

describe('labels', () => {
  it('maps status and source', () => {
    expect(statusInfo('live')).toEqual({ label: 'Live', tone: 'green' });
    expect(statusInfo('redirect')).toEqual({ label: 'Redirect', tone: 'amber' });
    expect(statusInfo('down')).toEqual({ label: 'Down', tone: 'red' });
    expect(statusInfo('weird').label).toBe('Down');
    expect(sourceLabel('deployment')).toBe('Deployment');
    expect(sourceLabel('pages')).toBe('Pages');
    expect(sourceLabel('readme')).toBe('README');
    expect(sourceLabel('homepage')).toBe('Homepage');
  });
  it('shows the final url only for redirects', () => {
    expect(redirectTarget(c('https://a.dev', 'redirect', { finalUrl: 'https://b.dev' }))).toBe(
      'https://b.dev',
    );
    expect(redirectTarget(c('https://a.dev', 'live'))).toBeNull();
    expect(redirectTarget(c('https://a.dev', 'redirect', { finalUrl: null }))).toBeNull();
  });
});

describe('buildImportBody', () => {
  it('caps urls and shapes the status page option', () => {
    const urls = Array.from({ length: 60 }, (_, i) => `https://s${i}.dev`);
    expect(buildImportBody(urls, null).urls).toHaveLength(50);
    expect(buildImportBody(['https://a.dev'], null)).toEqual({ urls: ['https://a.dev'] });
    expect(buildImportBody(['u'], { mode: 'create', title: '  My apps ' }).statusPage).toEqual({
      mode: 'create',
      title: 'My apps',
    });
    expect(buildImportBody(['u'], { mode: 'create', title: ' ' }).statusPage).toEqual({
      mode: 'create',
    });
    expect(buildImportBody(['u'], { mode: 'extend', id: 'sp1' }).statusPage).toEqual({
      mode: 'extend',
      id: 'sp1',
    });
    expect(buildImportBody(['u'], { mode: 'extend' }).statusPage).toBeUndefined();
  });
});

describe('errors', () => {
  const err = (code, extra = {}) => ({
    response: { data: { error: { code, message: 'srv', ...extra } } },
  });
  const now = Date.parse('2026-01-01T00:00:00Z');
  it('formats retry times', () => {
    expect(formatRetryIn(null, now)).toBeNull();
    expect(formatRetryIn('nope', now)).toBeNull();
    expect(formatRetryIn('2026-01-01T00:00:30Z', now)).toBe('in 30 seconds');
    expect(formatRetryIn('2026-01-01T00:12:00Z', now)).toBe('in 12 minutes');
    expect(formatRetryIn('2026-01-01T00:01:00Z', now)).toBe('in 1 minute');
    expect(formatRetryIn('2026-01-01T02:00:00Z', now)).toBe('in 2 hours');
    expect(formatRetryIn('2025-12-31T00:00:00Z', now)).toBe('in a moment');
  });
  it('maps api codes', () => {
    expect(githubErrorInfo(err('GITHUB_NOT_LINKED')).action).toBe('signin');
    const limited = githubErrorInfo(
      err('GITHUB_RATE_LIMITED', { resetAt: '2026-01-01T00:12:00Z' }),
      now,
    );
    expect(limited.message).toContain('in 12 minutes');
    expect(limited.action).toBe('retry');
    expect(githubErrorInfo(err('GITHUB_RATE_LIMITED'), now).message).toContain('little while');
    expect(githubErrorInfo(err('GITHUB_UNAVAILABLE')).title).toBe('GitHub is unavailable');
    expect(githubErrorInfo(err('FORBIDDEN')).action).toBeNull();
    expect(githubErrorInfo(err('WHATEVER')).message).toBe('srv');
    expect(githubErrorInfo(new Error('x')).code).toBe('NETWORK');
  });
});
