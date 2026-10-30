import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';
import { cn } from '../../lib/cn.js';

const NAV_ITEMS = [
  { to: '', label: 'Overview', short: 'Overview', end: true },
  { to: 'incidents', label: 'Incidents', short: 'Incidents' },
  { to: 'status-pages', label: 'Status pages', short: 'Pages' },
  { to: 'alerts', label: 'Alert channels', short: 'Alerts' },
  { to: 'usage', label: 'Cost & usage', short: 'Usage' },
  { to: 'team', label: 'Team', short: 'Team' },
  { to: 'settings', label: 'Settings', short: 'Settings' },
];

// The console has its own layout and navigation, outside any workspace.
const ADMIN_ITEM = { to: 'admin', label: 'Admin', short: 'Admin' };

const href = (wid, to) => {
  if (to === ADMIN_ITEM.to) return '/app/admin';
  return to ? `/app/${wid}/${to}` : `/app/${wid}`;
};

/**
 * Text navigation. Desktop: a row under the header line (active = text-fg,
 * the rest text-faint). Mobile: the same links in a hairline bottom bar.
 */
export default function TextNav({ wid }) {
  const { isAdmin } = useAuth();
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
  return (
    <>
      <nav aria-label="Main" className="hidden md:block">
        <ul className="flex flex-wrap gap-x-7 gap-y-1">
          {items.map(({ to, label, end }) => (
            <li key={label}>
              <NavLink
                to={href(wid, to)}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'block py-1 text-[13px] transition-colors duration-200 ease-(--ease) hover:text-fg',
                    isActive ? 'text-fg' : 'text-faint',
                  )
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <nav
        aria-label="Main (mobile)"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="flex justify-between px-2">
          {items.map(({ to, short, end }) => (
            <li key={short} className="min-w-0 flex-1">
              <NavLink
                to={href(wid, to)}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'relative block truncate px-0.5 py-3.5 text-center transition-colors duration-200',
                    items.length > NAV_ITEMS.length ? 'text-[10px]' : 'text-[11px]',
                    isActive ? 'text-fg' : 'text-faint',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span aria-hidden="true" className="absolute inset-x-3 top-0 h-px bg-brand" />
                    )}
                    {short}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
