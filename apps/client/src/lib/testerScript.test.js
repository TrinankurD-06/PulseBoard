import { describe, expect, it } from 'vitest';
import { isExcludedPath, isTesterScriptLoaded, loadTesterScript } from './testerScript.js';

/** Just enough of a document to add and find a script element. */
function fakeDocument() {
  const scripts = [];
  return {
    scripts,
    head: { appendChild: (el) => scripts.push(el) },
    createElement: () => {
      const attributes = {};
      return {
        attributes,
        setAttribute: (name, value) => {
          attributes[name] = value;
        },
        set src(value) {
          attributes.src = value;
        },
        get src() {
          return attributes.src;
        },
      };
    },
    querySelector: (selector) => {
      const src = /src="([^"]+)"/.exec(selector)?.[1];
      return scripts.find((s) => s.src === src) ?? null;
    },
  };
}

describe('isExcludedPath', () => {
  it.each([
    '/status/acme',
    '/status/acme/',
    '/app/admin',
    '/app/admin/users',
    '/app/admin/users/1',
  ])('excludes %s', (path) => expect(isExcludedPath(path)).toBe(true));

  it.each([
    '/',
    '/login',
    '/app',
    '/app/abc123',
    '/app/abc123/team',
    '/app/abc123/admin',
    '/statuses',
    '/app/administrators',
  ])('allows %s', (path) => expect(isExcludedPath(path)).toBe(false));
});

describe('loadTesterScript', () => {
  it('adds one async script with the given attributes, once', () => {
    const doc = fakeDocument();
    expect(isTesterScriptLoaded(doc)).toBe(false);
    expect(loadTesterScript(doc)).toBe(true);
    expect(loadTesterScript(doc)).toBe(false);
    expect(doc.scripts).toHaveLength(1);
    const [script] = doc.scripts;
    expect(script.async).toBe(true);
    expect(script.attributes.src).toBe('https://cdn.firstusers.aevrinlabs.com/v1/fu.js');
    expect(script.attributes['data-app']).toBe('app_01M6856067WQX12XDFSX4Y106P');
    expect(script.attributes['data-api']).toBe(
      'https://firstusers-api.n31vfqjhge7aa.ap-south-1.cs.amazonlightsail.com',
    );
    expect(isTesterScriptLoaded(doc)).toBe(true);
  });
});
