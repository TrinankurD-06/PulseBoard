import { LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.js';
import { useIncidents } from '../../api/incidents.js';
import { cn } from '../../lib/cn.js';
import { liveStatus } from '../../lib/liveStatus.js';
import Logo from '../Logo.jsx';
import ThemeToggle from '../ThemeToggle.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';

/** Pulsing dot + phrase: realtime connection and open incidents. */
function LiveStatus({ wid, connected }) {
  // limit 1: only the envelope's total is read. Polls only while offline.
  const { data } = useIncidents(wid, { status: 'open', limit: 1 });
  const status = liveStatus({ connected, openIncidents: data?.pagination?.total ?? null });
  return (
    <span
      role="status"
      title={status.title}
      className="flex shrink-0 items-center gap-2 text-xs text-muted"
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-pill', status.dot, status.pulse && 'animate-live-pulse')}
      />
      <span className="hidden sm:inline">{status.label}</span>
      <span className="sr-only sm:hidden">{status.label}</span>
    </span>
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-pill border border-line text-xs text-muted transition-colors duration-200 hover:border-line-strong hover:text-fg"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="animate-modal-in absolute right-0 z-40 mt-2 w-60 rounded-card border border-line-strong bg-bg/90 p-4 backdrop-blur-md"
        >
          <p className="truncate text-sm text-fg">{user?.name}</p>
          <p className="truncate text-xs text-faint">{user?.email}</p>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="mt-4 flex items-center gap-2 text-[13px] text-muted transition-colors hover:text-fg"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Wordmark left, a 1px hairline filling the middle, live status and the user
 * menu on the right; the workspace switcher sits beside the wordmark.
 */
export default function HeaderLine({ wid, connected }) {
  return (
    <header className="flex items-center gap-3 sm:gap-5">
      <Logo to={`/app/${wid}`} className="shrink-0" />
      <WorkspaceSwitcher wid={wid} />
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-line" />
      <LiveStatus wid={wid} connected={connected} />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
