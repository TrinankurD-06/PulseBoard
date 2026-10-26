import { useEffect } from 'react';

/** Sets the browser tab title, e.g. "Incidents · PulseBoard". */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · PulseBoard` : 'PulseBoard';
  }, [title]);
}
