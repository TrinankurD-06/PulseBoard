import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Link to="/login" className="rounded-md px-3 py-2 text-sm font-medium hover:underline">
            Log in
          </Link>
        </nav>
      </header>
      <section className="mx-auto max-w-3xl px-4 pt-20 pb-16 text-center sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Know before your users do.
        </h1>
        <p className="mt-6 text-lg text-slate-600 dark:text-slate-400">
          Uptime monitoring with live dashboards, instant alerts and beautiful public status pages.
        </p>
        <Link
          to="/register"
          className="mt-10 inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500"
        >
          Start monitoring for free
        </Link>
      </section>
    </div>
  );
}
