import { describe, expect, it } from 'vitest';
import {
  classifyProbe,
  collectCandidates,
  extractLinks,
  extractReadmeCandidates,
  isExcludedUrl,
  normalizeUrl,
  urlKey,
} from '../src/github/index.js';

const README = `
# My project

[![Build](https://img.shields.io/github/actions/workflow/status/me/app/ci.yml)](https://github.com/me/app/actions)
[![npm](https://badge.fury.io/js/app.svg)](https://www.npmjs.com/package/app)
![screenshot](https://my-app.vercel.app/screenshot.png)

Live demo: [try it](https://my-app.vercel.app/) and the [Website](https://example.com/hello).
Docs: [documentation](https://docs.example.org/guide)
Also at https://my-app.netlify.app, and an <a href="https://old.herokuapp.com/x">old copy</a>.
<a href="https://shop.example.net"><img src="logo.png"></a>

\`\`\`sh
curl https://snippet.vercel.app/api
\`\`\`

[staging]: https://stage.fly.dev/ "Staging"
Run locally on http://localhost:3000 or [live](http://127.0.0.1:8080).
`;

describe('normalizeUrl / urlKey', () => {
  it('lowercases the host, drops the fragment and trailing slashes, keeps the root', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path/#top')).toBe('https://example.com/Path');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('  https://example.com/a/b//  ')).toBe('https://example.com/a/b');
  });

  it('refuses non-http URLs, credentials and garbage', () => {
    for (const bad of [
      'ftp://x.com',
      'javascript:alert(1)',
      'not a url',
      'https://u:p@x.com',
      null,
    ]) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });

  it('keys ignore scheme, www and the trailing slash', () => {
    expect(urlKey('http://www.Example.com/')).toBe(urlKey('https://example.com'));
    expect(urlKey('https://example.com/a/')).toBe(urlKey('https://example.com/a'));
    expect(urlKey('https://example.com/a')).not.toBe(urlKey('https://example.com/b'));
    expect(urlKey('https://example.com/?x=1')).not.toBe(urlKey('https://example.com/'));
  });
});

describe('isExcludedUrl', () => {
  it.each([
    'https://github.com/me/app',
    'https://gist.github.com/me/1',
    'https://raw.githubusercontent.com/me/app/main/a.png',
    'https://img.shields.io/badge/x-y-green',
    'https://badge.fury.io/js/app.svg',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'https://example.com/logo.PNG',
    'https://example.com/badge/build',
    'mailto:me@example.com',
  ])('excludes %s', (url) => expect(isExcludedUrl(url)).toBe(true));

  it.each(['https://me.github.io/app', 'https://my-app.vercel.app', 'https://example.com/docs'])(
    'keeps %s',
    (url) => expect(isExcludedUrl(url)).toBe(false),
  );
});

describe('extractLinks', () => {
  it('reads markdown, html, reference and bare links but not images or code blocks', () => {
    const urls = extractLinks(README).map((link) => link.url);
    expect(urls).toContain('https://my-app.vercel.app/');
    expect(urls).toContain('https://old.herokuapp.com/x');
    expect(urls).toContain('https://stage.fly.dev/');
    expect(urls).toContain('https://my-app.netlify.app');
    expect(urls).not.toContain('https://my-app.vercel.app/screenshot.png');
    expect(urls).not.toContain('https://snippet.vercel.app/api');
  });

  it('keeps the target of a badge that wraps an image', () => {
    const links = extractLinks(README);
    expect(links.find((link) => link.url === 'https://github.com/me/app/actions')).toBeTruthy();
  });

  it('is safe on empty or non-string input', () => {
    expect(extractLinks('')).toEqual([]);
    expect(extractLinks(undefined)).toEqual([]);
  });
});

describe('extractReadmeCandidates', () => {
  it('keeps hosting-domain links and links labelled demo/live/website, drops the rest', () => {
    expect(extractReadmeCandidates(README).sort()).toEqual(
      [
        'https://example.com/hello', // labelled "Website"
        'https://my-app.netlify.app/',
        'https://my-app.vercel.app/', // "Live demo"
        'https://old.herokuapp.com/x',
        'https://stage.fly.dev/',
      ].sort(),
    );
  });

  it('skips unlabelled links on ordinary domains and localhost "live" links', () => {
    const urls = extractReadmeCandidates(README);
    expect(urls).not.toContain('https://docs.example.org/guide');
    expect(urls).not.toContain('https://shop.example.net/');
    expect(urls.some((url) => url.includes('127.0.0.1'))).toBe(false);
  });

  it('knows every hosting domain', () => {
    const md = [
      'vercel.app',
      'netlify.app',
      'onrender.com',
      'github.io',
      'herokuapp.com',
      'pages.dev',
      'fly.dev',
      'railway.app',
    ]
      .map((domain) => `https://a.${domain}`)
      .join('\n');
    expect(extractReadmeCandidates(md)).toHaveLength(8);
  });

  it('dedupes the same site written two ways', () => {
    expect(
      extractReadmeCandidates(
        '[demo](https://a.vercel.app/) and http://a.vercel.app and [live](https://www.a.vercel.app)',
      ),
    ).toHaveLength(1);
  });
});

describe('collectCandidates', () => {
  it('ranks deployment > homepage > pages > readme', () => {
    const result = collectCandidates({
      readme: '[demo](https://readme.example.com)',
      pagesUrl: 'https://me.github.io/app/',
      homepage: 'https://home.example.com',
      deploymentUrls: ['https://deploy.example.com'],
    });
    expect(result.map((c) => c.source)).toEqual(['deployment', 'homepage', 'pages', 'readme']);
  });

  it('dedupes across sources and keeps the best source', () => {
    const result = collectCandidates({
      homepage: 'https://Example.com/',
      readme: '[live](https://example.com)',
      deploymentUrls: ['http://www.example.com'],
    });
    expect(result).toEqual([{ url: 'http://www.example.com/', source: 'deployment' }]);
  });

  it('drops excluded and invalid URLs and caps the list', () => {
    expect(
      collectCandidates({
        homepage: 'https://github.com/me/app',
        pagesUrl: 'nonsense',
        deploymentUrls: ['http://localhost:3000', null],
      }),
    ).toEqual([]);

    const many = Array.from({ length: 9 }, (_, i) => `https://s${i}.example.com`);
    expect(collectCandidates({ deploymentUrls: many })).toHaveLength(4);
    expect(collectCandidates({ deploymentUrls: many, max: 2 })).toHaveLength(2);
  });

  it('is stable: ties sort by URL', () => {
    const result = collectCandidates({ deploymentUrls: ['https://b.com', 'https://a.com'] });
    expect(result.map((c) => c.url)).toEqual(['https://a.com/', 'https://b.com/']);
  });
});

describe('classifyProbe', () => {
  const ok = (statusCode, finalUrl) => ({ ok: true, statusCode, finalUrl });

  it('live when it answered on the same site (www and trailing slash do not matter)', () => {
    expect(classifyProbe('https://a.com/', ok(200, 'https://a.com/'))).toEqual({
      status: 'live',
      statusCode: 200,
    });
    expect(classifyProbe('https://a.com', ok(200, 'https://www.a.com/')).status).toBe('live');
    expect(classifyProbe('http://a.com', ok(200, 'https://a.com/')).status).toBe('live');
  });

  it('redirect when it ended on another host or path', () => {
    expect(classifyProbe('https://a.com/', ok(200, 'https://b.com/')).status).toBe('redirect');
    expect(classifyProbe('https://a.com/', ok(200, 'https://a.com/login')).status).toBe('redirect');
  });

  it('down for errors, timeouts, blocks and 4xx/5xx', () => {
    expect(classifyProbe('https://a.com', { ok: false, statusCode: null })).toEqual({
      status: 'down',
      statusCode: null,
    });
    expect(classifyProbe('https://a.com', { ok: false, statusCode: 503 }).status).toBe('down');
    expect(classifyProbe('https://a.com', ok(404, 'https://a.com/')).status).toBe('down');
    expect(classifyProbe('https://a.com', undefined).status).toBe('down');
  });
});
