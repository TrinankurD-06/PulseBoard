import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePublicStatus } from '../api/statusPages.js';
import UptimeBars from '../components/charts/UptimeBars.jsx';
import UptimeLegend from '../components/charts/UptimeLegend.jsx';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useNow } from '../hooks/useNow.js';
import { cn } from '../lib/cn.js';
import { formatDuration, timeAgo } from '../lib/format.js';

// Overall banner. Colour is always paired with an icon and words.
const OVERALL = {
  operational: {
    icon: CheckCircle2,
    text: 'All systems operational',
    classes:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  partial_outage: {
    icon: AlertTriangle,
    text: 'Some systems are experiencing problems',
    classes:
      'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  major_outage: {
    icon: XCircle,
    text: 'Major outage',
    classes:
      'border-red-200 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
    iconClass: 'text-red-600 dark:text-red-400',
  },
  no_data: {
    icon: CircleSlash,
    text: 'No services are being monitored yet',
    classes:
      'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200',
    iconClass: 'text-slate-500',
  },
};

// Customer-facing wording for each monitor status.
const COMPONENT_STATUS = {
  up: { label: 'Operational', dot: 'bg-status-up', text: 'text-emerald-700 dark:text-emerald-400' },
  // Agent silent but the app answers: an internal concern, operational to visitors.
  degraded: {
    label: 'Operational',
    dot: 'bg-status-up',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
  down: { label: 'Outage', dot: 'bg-status-down', text: 'text-red-700 dark:text-red-400' },
  pending: {
    label: 'Checking',
    dot: 'bg-status-pending',
    text: 'text-amber-700 dark:text-amber-400',
  },
  paused: { label: 'Not monitored', dot: 'bg-status-paused', text: 'text-slate-500' },
};

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {children}
        <footer className="mt-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          Powered by <Logo />
        </footer>
      </div>
    </div>
  );
}

function ComponentRow({ monitor }) {
  const status = COMPONENT_STATUS[monitor.status] ?? COMPONENT_STATUS.pending;
  return (
    <li className="px-5 py-5 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-medium">{monitor.name}</h3>
        <span className={cn('flex items-center gap-1.5 text-sm font-medium', status.text)}>
          <span className={cn('h-2 w-2 rounded-full', status.dot)} aria-hidden="true" />
          {status.label}
        </span>
      </div>
      <UptimeBars days={monitor.days} />
      <p className="mt-1 text-right text-xs text-slate-500">
        {monitor.uptime90 == null ? 'No data yet' : `${monitor.uptime90}% uptime over 90 days`}
      </p>
    </li>
  );
}

function IncidentRow({ incident, now }) {
  const ongoing = !incident.resolvedAt;
  const duration = ongoing
    ? (now - new Date(incident.startedAt).getTime()) / 1000
    : incident.durationSec;
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-5 py-4 sm:px-6">
      <div>
        <p className="font-medium">
          {incident.monitorName} {ongoing ? 'is unavailable' : 'was unavailable'}
        </p>
        <p className="text-sm text-slate-500">
          {new Date(incident.startedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}{' '}
          · {ongoing ? 'ongoing for' : 'lasted'} {formatDuration(duration)}
        </p>
      </div>
      <span
        className={cn(
          'rounded-full px-2.5 py-0.5 text-xs font-medium',
          ongoing
            ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
        )}
      >
        {ongoing ? 'Investigating' : 'Resolved'}
      </span>
    </li>
  );
}

/** /status/:slug: the public status page. No login; refreshes every 30s. */
export default function PublicStatus() {
  const { slug } = useParams();
  const { data, isPending, error, dataUpdatedAt } = usePublicStatus(slug);
  const now = useNow(5000);

  useEffect(() => {
    document.title = data ? `${data.title} · Status` : 'Status';
  }, [data]);

  if (isPending) {
    return (
      <Shell>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-8 h-20 rounded-xl" />
        <Skeleton className="mt-6 h-64 rounded-xl" />
      </Shell>
    );
  }

  if (error) {
    const missing = error.response?.status === 404;
    return (
      <Shell>
        <div className="py-20 text-center">
          <h1 className="text-2xl font-semibold">
            {missing ? 'Status page not found' : 'Status is temporarily unavailable'}
          </h1>
          <p className="mt-2 text-slate-500">
            {missing ? "This page doesn't exist or isn't public." : 'Please try again in a moment.'}
          </p>
          <Link
            to="/"
            className="mt-6 inline-block text-brand-600 hover:underline dark:text-brand-400"
          >
            Go to PulseBoard
          </Link>
        </div>
      </Shell>
    );
  }

  const overall = OVERALL[data.overall] ?? OVERALL.no_data;
  const OverallIcon = overall.icon;

  return (
    <Shell>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{data.title}</h1>
          {data.description && (
            <p className="mt-2 text-slate-600 dark:text-slate-400">{data.description}</p>
          )}
        </div>
        <ThemeToggle />
      </header>

      <section
        className={cn(
          'surface-3d mt-8 flex items-center gap-3 rounded-xl border px-5 py-5 sm:px-6',
          overall.classes,
        )}
        role="status"
      >
        <OverallIcon className={cn('h-7 w-7 shrink-0', overall.iconClass)} aria-hidden="true" />
        <p className="text-lg font-semibold">{overall.text}</p>
      </section>
      <p className="mt-2 text-right text-xs text-slate-500">
        Updated {timeAgo(dataUpdatedAt, now)} · refreshes every 30 seconds
      </p>

      {data.monitors.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Services
          </h2>
          <div className="surface-3d rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.monitors.map((monitor, i) => (
                <ComponentRow key={`${monitor.name}-${i}`} monitor={monitor} />
              ))}
            </ul>
            <div className="border-t border-slate-200 px-5 py-3 sm:px-6 dark:border-slate-800">
              <UptimeLegend />
            </div>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Past 30 days
        </h2>
        <div className="surface-3d rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
          {data.incidents.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">No incidents reported. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.incidents.map((incident) => (
                <IncidentRow
                  key={`${incident.monitorName}-${incident.startedAt}`}
                  incident={incident}
                  now={now}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </Shell>
  );
}
