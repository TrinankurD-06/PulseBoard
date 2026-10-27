import { useCallback, useMemo, useState } from 'react';
import { ThemeContext } from './ThemeContext.js';

function readTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Dark-first theme stored in localStorage, applied as data-theme on <html>
 * (tokens.css redefines the tokens for "light"); index.html sets it before
 * first paint.
 */
export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readTheme);

  const toggleTheme = useCallback(() => {
    const next = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this visit.
    }
    setTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
