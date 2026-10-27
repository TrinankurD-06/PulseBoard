import { useRealtime } from '../../realtime/useRealtime.js';
import { AppShellContext } from './appShellContext.js';
import HeaderLine from './HeaderLine.jsx';
import TextNav from './TextNav.jsx';

/**
 * The logged-in frame: a header line and a text nav on top (a hairline bottom bar
 * on mobile), the page below. No sidebar. Used by AppLayout for every
 * /app/:wid page and by error pages shown to a logged-in user.
 */
export default function AppShell({ wid, children }) {
  const { connected } = useRealtime();
  return (
    <AppShellContext.Provider value={true}>
      <div className="mx-auto min-h-screen w-full max-w-7xl px-4 pt-4 pb-24 sm:px-6 md:pb-12 lg:px-8">
        <div className="space-y-3 pb-10">
          <HeaderLine wid={wid} connected={connected} />
          <TextNav wid={wid} />
        </div>
        <main>{children}</main>
      </div>
    </AppShellContext.Provider>
  );
}
