import { useCallback, useState } from 'react';

function readTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Dark-first theme stored in localStorage; index.html applies it before first paint. */
export function useTheme() {
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

  return { theme, toggleTheme };
}
