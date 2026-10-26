import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../src/lib/slug.js';

describe('slugify', () => {
  it('lowercases, strips accents and collapses punctuation', () => {
    expect(slugify('  Café & Bar — Production!! ')).toBe('cafe-bar-production');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('adds a random suffix and falls back to "workspace"', () => {
    expect(uniqueSlug('My Team')).toMatch(/^my-team-[a-f0-9]{6}$/);
    expect(uniqueSlug('???')).toMatch(/^workspace-[a-f0-9]{6}$/);
    expect(uniqueSlug('x')).not.toBe(uniqueSlug('x'));
  });
});
