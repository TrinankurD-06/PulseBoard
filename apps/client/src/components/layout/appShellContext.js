import { createContext } from 'react';

/**
 * True inside <AppShell>. An error page rendered there shows only its message;
 * rendered anywhere else it supplies the one layout it needs (see lib/errorLayout.js).
 */
export const AppShellContext = createContext(false);
