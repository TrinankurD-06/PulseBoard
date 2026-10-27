import { Activity, BellRing, Gauge, Globe, ShieldCheck, Users, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import Sparkline from '../components/charts/Sparkline.jsx';
import UptimeBars from '../components/charts/UptimeBars.jsx';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { primaryButtonClasses } from '../components/ui/Button.jsx';
import { cn } from '../lib/cn.js';

const DEMO_STATUS_PAGE = '/status/acme';

const FEATURES = [
  {
    icon: Zap,
    title: 'Checks every 10 seconds',
    text: 'HTTP checks with status, keyword and timeout rules, plus a DNS / TCP / TLS / TTFB breakdown of every request.',
  },
  {
    icon: ShieldCheck,
    title: 'Incidents without the noise',
    text: 'Down after 3 failed checks, up after 2 good ones. A single blip or a flapping endpoint never pages anyone.',
  },
  {
    icon: BellRing,
    title: 'Alerts where your team is',
    text: 'Discord, Slack and email, with automatic retries and a full timeline of what was sent when.',
  },
  {
    icon: Activity,
    title: 'A dashboard that is actually live',
    text: 'Status, response times and incidents update in your browser the moment a check finishes.',
  },
  {
    icon: Globe,
    title: 'Public status pages',
    text: 'A clean page with 90-day uptime bars and incident history for your customers. No login needed.',
  },
  {
    icon: Users,
    title: 'Built for teams',
    text: 'Workspaces with owner, member and viewer roles, so everyone sees what they need.',
  },
];

const STEPS = [
  ['Add a URL', 'Paste the address of your site or API and choose how often to check it.'],
  [
    'We keep watch',
    'Checks run around the clock from our workers; results stream to your dashboard.',
  ],
  [
    'You hear first',
    'When something breaks, your team is alerted, and your status page updates itself.',
  ],
];

// Static sample data for the product preview.
const previewDays = Array.from({ length: 45 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
  uptime: i === 17 ? 98.7 : i === 33 ? 99.6 : 100,
  downtimeSec: i === 17 ? 1120 : i === 33 ? 340 : 0,
  totalChecks: 8640,
}));
const sparkline = (base, spread, failAt) =>
  Array.from({ length: 30 }, (_, i) => ({
    ms: base + Math.round(Math.sin(i / 2.5) * spread + ((i * 37) % 11)),
    ok: i !== failAt,
  }));
const PREVIEW_MONITORS = [
  { name: 'Checkout API', status: 'Up', dot: 'bg-status-up', points: sparkline(42, 9) },
  { name: 'Marketing site', status: 'Up', dot: 'bg-status-up', points: sparkline(120, 25) },
  {
    name: 'Payments webhook',
    status: 'Down',
    dot: 'bg-status-down',
    points: sparkline(80, 18, 29),
  },
];

function ProductPreview() {
  return (
    <div className="tilt-3d rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-orange-900/15 sm:p-6 dark:border-slate-800 dark:bg-slate-900 dark:shadow-brand-500/10">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">Acme Inc.</p>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-2 w-2 rounded-full bg-status-up" /> Live
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {PREVIEW_MONITORS.map((monitor) => (
          <li
            key={monitor.name}
            className="surface-3d rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', monitor.dot)} />
              <span className="flex-1 truncate text-sm font-medium">{monitor.name}</span>
              <span
                className={cn(
                  'text-xs font-medium',
                  monitor.status === 'Up'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400',
                )}
              >
                {monitor.status}
              </span>
            </div>
            <div className="mt-2">
              <Sparkline points={monitor.points} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <p className="mb-2 text-xs text-slate-500">Uptime, last 45 days · 99.96%</p>
        <UptimeBars days={previewDays} />
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            to={DEMO_STATUS_PAGE}
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 sm:block dark:text-slate-400 dark:hover:text-slate-100"
          >
            Status page demo
          </Link>
          <ThemeToggle />
          <Link to="/login" className="rounded-md px-3 py-2 text-sm font-medium hover:underline">
            Log in
          </Link>
          <Link
            to="/register"
            className={cn('rounded-lg px-3 py-2 text-sm font-semibold', primaryButtonClasses)}
          >
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
            <Gauge className="h-3.5 w-3.5" /> Uptime monitoring · Alerts · Status pages
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Know before your users do.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            PulseBoard checks your websites and APIs every few seconds, alerts your team the moment
            something breaks, and keeps your customers informed with a public status page.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className={cn(
                'w-full rounded-lg px-6 py-3 font-semibold sm:w-auto',
                primaryButtonClasses,
              )}
            >
              Start monitoring for free
            </Link>
            <Link
              to={DEMO_STATUS_PAGE}
              className="w-full rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold hover:bg-slate-50 sm:w-auto dark:border-slate-700 dark:bg-transparent dark:hover:bg-slate-900"
            >
              See a live status page
            </Link>
          </div>
        </section>

        <section
          className="relative isolate mx-auto max-w-5xl px-4 pb-20 sm:px-6"
          aria-label="Product preview"
        >
          {/* Soft glow behind the tilted preview: green on peach, pale orange on black. */}
          <div
            className="pointer-events-none absolute inset-x-10 top-10 bottom-24 -z-10 rounded-full bg-brand-400/25 blur-3xl dark:bg-brand-500/15"
            aria-hidden="true"
          />
          <ProductPreview />
        </section>

        <section className="border-t border-slate-200 bg-slate-100/70 py-20 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              Everything you need to stay up
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div
                  key={title}
                  className="surface-3d rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="inline-flex rounded-lg bg-brand-50 p-2 shadow-sm ring-1 ring-brand-200 dark:bg-brand-500/10 dark:shadow-none dark:ring-brand-500/20">
                    <Icon
                      className="h-5 w-5 text-brand-600 dark:text-brand-400"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Set up in a minute</h2>
          <ol className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 font-semibold text-white shadow-md dark:bg-brand-600 dark:text-on-brand dark:shadow-brand-500/30">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-14 text-center">
            <Link
              to="/register"
              className={cn(
                'inline-block rounded-lg px-6 py-3 font-semibold',
                primaryButtonClasses,
              )}
            >
              Create your free account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800">
        PulseBoard · built with MongoDB, Express, React and Node.js
      </footer>
    </div>
  );
}
