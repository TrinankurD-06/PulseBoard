import { Outlet } from 'react-router-dom';
import Logo from '../Logo.jsx';
import ThemeToggle from '../ThemeToggle.jsx';

/** Shell for authenticated pages. Sidebar navigation and workspace switcher arrive in phase 2. */
export default function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
        <Logo to="/app" />
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
