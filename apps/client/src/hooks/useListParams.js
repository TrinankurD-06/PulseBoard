import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_PAGE_SIZE, parsePage } from '../lib/adminConsole.js';

/**
 * Filters and the page of an admin list, kept in the URL (so a filtered view can be linked
 * and survives a reload). `defaults` names the filters and their default values; a filter
 * equal to its default is left out of the URL. `set({ status: 'open' })` changes filters
 * and goes back to page 1; `set({ page: 3 })` only changes the page.
 */
export function useListParams(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);

  const params = useMemo(() => {
    const base = JSON.parse(defaultsKey);
    const out = {};
    for (const key of Object.keys(base)) out[key] = searchParams.get(key) ?? base[key];
    out.page = parsePage(searchParams.get('page'));
    out.limit = DEFAULT_PAGE_SIZE;
    return out;
  }, [searchParams, defaultsKey]);

  const set = useCallback(
    (patch) => {
      const base = JSON.parse(defaultsKey);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            const blank = value === undefined || value === null || value === '' || value === false;
            if (blank || value === base[key] || (key === 'page' && Number(value) <= 1)) {
              next.delete(key);
            } else {
              next.set(key, value === true ? 'true' : String(value));
            }
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaultsKey],
  );

  return [params, set];
}
