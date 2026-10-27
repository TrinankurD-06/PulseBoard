import {
  AlertTriangle,
  Bell,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import { cn } from '../../lib/cn.js';
import { useRealtime } from '../../realtime/useRealtime.js';
import NotFound from '../../pages/NotFound.jsx';
import Logo from '../Logo.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';

const NAV_ITEMS = [
  { to: '', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { to: 'alerts', label: 'Alert channels', icon: Bell },
  { to: 'status-pages', label: 'Status pages', icon: Globe },
  { to: 'usage', label: 'Cost & usage', icon: Receipt },
  { to: 'team', label: 'Team', icon: Users },
  { to: 'settings', label: 'Settings', icon: Settings },
];

/** Shows whether live updates are flowing (Socket.io connected). */
function LiveIndicator({ connected }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-slate-500"
      title={
        connected ? 'Receiving live updates' : 'Reconnecting; data refreshes every 30s meanwhile'
      }
    >
      <span
        className={cn('h-2 w-2 rounded-full', connected ? 'bg-status-up' : 'bg-status-paused')}
      />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

function Sidebar({ onNavigate, connected }) {
  const { wid } = useCurrentWorkspace();
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="hidden lg:block">
        <Logo to={`/app/${wid}`} />
      </div>
      <WorkspaceSwitcher />
      <LiveIndicator connected={connected} />
      <nav className="flex-1 space-y-1" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label}
            to={to ? `/app/${wid}/${to}` : `/app/${wid}`}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700 shadow-sm dark:bg-brand-500/10 dark:text-brand-400 dark:shadow-none'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          aria-label="Log out"
          title="Log out"
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/** Shell for every /app/:wid page: sidebar on desktop, slide-in drawer on mobile. */
export default function AppLayout() {
  const { workspace } = useCurrentWorkspace();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { connected } = useRealtime();

  if (!workspace)
    return <NotFound message="This workspace doesn't exist or you're not a member." />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-slate-200 lg:block dark:border-slate-800">
        <div className="sticky top-0 h-screen">
          <Sidebar connected={connected} />
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 lg:hidden dark:border-slate-800">
        <Logo to={`/app/${workspace.id}`} />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white shadow-xl dark:bg-black">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-3 right-3 rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="h-full pt-10">
              <Sidebar onNavigate={() => setDrawerOpen(false)} connected={connected} />
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
