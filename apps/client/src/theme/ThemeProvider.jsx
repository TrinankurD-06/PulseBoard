import { useCallback, useMemo, useState } from 'react';
import { ThemeContext } from './ThemeContext.js';

function readTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Dark-first theme stored in localStorage; index.html applies it before first paint. */
export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readTheme);

  const toggleTheme = useCallback(() => {
    const next = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
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
