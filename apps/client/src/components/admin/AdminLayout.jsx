import { ArrowLeft } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';
import { ADMIN_NAV } from '../../lib/adminConsole.js';
import { cn } from '../../lib/cn.js';
import NotFound from '../../pages/NotFound.jsx';
import { UserMenu } from '../layout/HeaderLine.jsx';
import { AppShellContext } from '../layout/appShellContext.js';
import Logo from '../Logo.jsx';
import ThemeToggle from '../ThemeToggle.jsx';

const linkClasses = 'block py-1 text-[13px] transition-colors duration-200 ease-(--ease)';

/**
 * The platform admin console's own frame: the app's header chrome (wordmark, theme toggle,
 * account menu) and a navigation of its own, not the workspace navigation. Anyone who is not
 * a platform administrator gets the ordinary "not found" page, as the server does.
 */
export default function AdminLayout() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <NotFound message="This page doesn't exist." />;

  return (
    <AppShellContext.Provider value={true}>
      <div className="mx-auto min-h-screen w-full max-w-7xl px-4 pt-4 pb-16 sm:px-6 lg:px-8">
        <div className="space-y-3 pb-10">
          <header className="flex items-center gap-3 sm:gap-5">
            <Logo to="/app/admin" className="shrink-0" />
            <span className="shrink-0 rounded-pill border border-line px-2.5 py-0.5 text-[11px] text-muted">
              Admin console
            </span>
            <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-line" />
            <ThemeToggle />
            <UserMenu />
          </header>
          <nav aria-label="Admin console">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-1">
              {ADMIN_NAV.map(({ to, label, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(linkClasses, 'hover:text-fg', isActive ? 'text-fg' : 'text-faint')
                    }
                  >
                    {label}
                  </NavLink>
                </li>
              ))}
              <li className="sm:ml-auto">
                <Link
                  to="/app"
                  className={cn(linkClasses, 'flex items-center gap-1.5 text-muted hover:text-fg')}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back to my workspace
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <main>
          <Outlet />
        </main>
      </div>
    </AppShellContext.Provider>
  );
}
