import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_KEY,
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from './theme.js';

describe('resolveTheme', () => {
  it('prefers a stored choice over the OS preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
  it('follows the OS when nothing valid is stored', () => {
    expect(resolveTheme(null, true)).toBe('light');
    expect(resolveTheme(null, false)).toBe('dark');
    expect(resolveTheme('sepia', true)).toBe('light');
  });
  it('knows the valid names', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('auto')).toBe(false);
  });
});

// The suite runs in Node, so the few browser globals theme.js touches are stubbed.
describe('storage and apply', () => {
  let store;
  let meta;
  let root;
  beforeEach(() => {
    store = new Map();
    meta = { content: '#0a0a09', setAttribute: (_name, value) => (meta.content = value) };
    root = { dataset: {}, style: {} };
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
      },
    });
    vi.stubGlobal('document', { documentElement: root, querySelector: () => meta });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips the stored theme and ignores junk', () => {
    expect(readStoredTheme()).toBeNull();
    storeTheme('light');
    expect(readStoredTheme()).toBe('light');
    store.set(THEME_KEY, 'nope');
    expect(readStoredTheme()).toBeNull();
  });
  it('survives storage that throws', () => {
    window.localStorage.getItem = () => {
      throw new Error('blocked');
    };
    window.localStorage.setItem = () => {
      throw new Error('blocked');
    };
    expect(readStoredTheme()).toBeNull();
    expect(() => storeTheme('light')).not.toThrow();
  });
  it('sets data-theme, color-scheme and the browser chrome colour', () => {
    applyTheme('light');
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(meta.content).toBe('#fbf3e8');
    applyTheme('dark');
    expect(meta.content).toBe('#0a0a09');
  });
});
