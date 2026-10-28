// Light/dark theme. The choice is stored in localStorage; with none stored the
// operating system's preference decides. The same logic runs as an inline
// script in index.html (before first paint, so there is no flash), so keep the
// two in step.

export const THEME_KEY = 'pulseboard-theme';
export const THEMES = ['dark', 'light'];

// Browser chrome colour per theme (the --bg token of each).
export const THEME_COLORS = { dark: '#0a0a09', light: '#fbf3e8' };

export function isTheme(value) {
  return THEMES.includes(value);
}

/** The theme to show: a stored choice wins, else the OS preference, else dark. */
export function resolveTheme(stored, prefersLight) {
  if (isTheme(stored)) return stored;
  return prefersLight ? 'light' : 'dark';
}

export function readStoredTheme() {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice just lasts for this visit.
  }
}

/** Puts the theme on <html> and updates the browser chrome colour. */
export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
