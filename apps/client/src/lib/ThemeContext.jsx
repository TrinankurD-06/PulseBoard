import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { applyTheme, isTheme, readStoredTheme, resolveTheme, storeTheme } from './theme.js';

const ThemeContext = createContext({ theme: 'dark', setTheme: () => {}, toggleTheme: () => {} });

const lightQuery = () => window.matchMedia?.('(prefers-color-scheme: light)');

function initialTheme() {
  const fromHtml = document.documentElement.dataset.theme;
  if (isTheme(fromHtml)) return fromHtml;
  return resolveTheme(readStoredTheme(), lightQuery()?.matches);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);

  // A layout effect: the tokens must change before children's effects read them.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the OS while the visitor has not made a choice of their own.
  useEffect(() => {
    const query = lightQuery();
    if (!query) return undefined;
    const onChange = () => {
      if (!readStoredTheme()) setThemeState(query.matches ? 'light' : 'dark');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next) => {
    if (!isTheme(next)) return;
    storeTheme(next);
    setThemeState(next);
  }, []);
  const toggleTheme = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  return useContext(ThemeContext);
}
