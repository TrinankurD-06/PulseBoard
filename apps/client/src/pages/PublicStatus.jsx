import { formatUptime, truncateTo } from '@pulseboard/shared/uptime';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UPTIME_TARGET, UPTIME_WARN_TARGET, uptimeGaugeProps } from '../lib/uptimeLevels.js';
import { usePublicStatus } from '../api/statusPages.js';
import UptimeBars from '../components/charts/UptimeBars.jsx';
import UptimeLegend from '../components/charts/UptimeLegend.jsx';
import TickGauge from '../components/gauge/TickGauge.jsx';
import ErrorPage from '../components/ErrorPage.jsx';
import SampleBadge from '../components/ui/SampleBadge.jsx';
import PublicHeader from '../components/public/PublicHeader.jsx';
import SignalFieldLazy from '../components/signal/SignalFieldLazy.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useNow } from '../hooks/useNow.js';
import { useStatusSignal } from '../hooks/useSignalFeed.js';
import { cn } from '../lib/cn.js';
import { formatDuration, timeAgo } from '../lib/format.js';

// Overall headline. The dot and the words always travel together.
const OVERALL = {
  operational: { text: 'Everything is running.', dot: 'bg-status-up' },
  partial_outage: { text: 'Some systems are degraded.', dot: 'bg-status-degraded' },
  major_outage: { text: "We're having an outage.", dot: 'bg-status-down' },
  no_data: { text: 'Nothing is monitored yet.', dot: 'bg-status-paused' },
};

// Customer-facing wording for each monitor status.
const COMPONENT_STATUS = {
  up: { label: 'Operational', dot: 'bg-status-up' },
  // Agent silent but the app answers: an internal concern, operational to visitors.
  degraded: { label: 'Operational', dot: 'bg-status-up' },
  down: { label: 'Outage', dot: 'bg-status-down' },
  pending: { label: 'Checking', dot: 'bg-status-pending' },
  paused: { label: 'Not monitored', dot: 'bg-status-paused' },
};

function Shell({ children, footer }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-10 pb-16 sm:px-8">
        <div className="max-w-4xl">{children}</div>
      </main>
      {footer}
    </div>
  );
}

function ComponentRow({ monitor }) {
  const status = COMPONENT_STATUS[monitor.status] ?? COMPONENT_STATUS.pending;
  return (
    <li className="py-7">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-light tracking-[-0.02em] text-fg">{monitor.name}</h3>
        <span className="flex items-center gap-2 text-sm text-muted">
          <span className={cn('h-1.5 w-1.5 rounded-pill', status.dot)} aria-hidden="true" />
          {status.label}
        </span>
      </div>
      <UptimeBars days={monitor.days} />
      <p className="mt-1 text-right text-[11px] text-faint">
        {monitor.uptime90 == null
          ? 'No data yet'
          : `${formatUptime(monitor.uptime90)}% uptime over 90 days`}
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
    <li className="relative pb-8 pl-8 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1.5 left-0 h-2 w-2 rounded-pill',
          ongoing ? 'bg-status-down' : 'bg-status-up',
        )}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-fg">
          {incident.monitorName} {ongoing ? 'is unavailable' : 'was unavailable'}
          {incident.sample && <SampleBadge className="ml-3" />}
        </p>
        <span className="text-xs text-muted">{ongoing ? 'Investigating' : 'Resolved'}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {new Date(incident.startedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}{' '}
        · {ongoing ? 'ongoing for' : 'lasted'} {formatDuration(duration)}
      </p>
    </li>
  );
}

/** Average of the monitors' 90-day uptime (only those with data), or null. */
function overallUptime(monitors) {
  const values = monitors.map((m) => m.uptime90).filter((v) => typeof v === 'number');
  if (values.length === 0) return null;
  // Cut, not rounded: the page never claims more uptime than it measured.
  return truncateTo(values.reduce((a, b) => a + b, 0) / values.length, 3);
}

/** /status/:slug: the public status page. No login; refreshes every 30s. */
export default function PublicStatus() {
  const { slug } = useParams();
  const { data, isPending, error, dataUpdatedAt } = usePublicStatus(slug);
  const now = useNow(5000);
  const signal = useStatusSignal(data?.monitors);

  useEffect(() => {
    document.title = data ? `${data.title} · Status` : 'Status';
  }, [data]);

  if (isPending) {
    return (
      <Shell>
        <Skeleton className="h-16 w-full max-w-md" />
        <Skeleton className="mt-8 h-5 w-56" />
        <Skeleton className="mt-16 h-48" />
      </Shell>
    );
  }

  if (error) {
    // The same error page as everywhere else: the app shell for a logged-in
    // visitor, the public header otherwise.
    if (error.response?.status === 404) {
      return (
        <ErrorPage
          code="404"
          title="Status page not found."
          message="This page doesn't exist or isn't public."
        />
      );
    }
    return (
      <ErrorPage
        code="503"
        title="Status is temporarily unavailable."
        message="Please try again in a moment."
        action={{ label: 'Try again', onClick: () => window.location.reload() }}
      />
    );
  }

  const overall = OVERALL[data.overall] ?? OVERALL.no_data;
  const uptime = overallUptime(data.monitors);

  return (
    <Shell
      footer={
        <footer className="mx-auto flex w-full max-w-6xl justify-between gap-3 px-5 py-8 text-[11px] text-faint sm:px-8">
          <span>Checks every 60s</span>
          <span>
            Powered by{' '}
            <Link to="/" className="transition-colors duration-200 hover:text-fg">
              PulseBoard
            </Link>
          </span>
        </footer>
      }
    >
      <p className="text-[11px] text-faint">{data.title}</p>
      <div className="mt-4 grid items-center gap-10 md:grid-cols-[1fr_220px]">
        <div>
          <h1
            role="status"
            className="animate-rise font-light tracking-[-0.03em] text-fg"
            style={{ fontSize: 'clamp(40px, 6vw, 80px)', lineHeight: 1.03 }}
          >
            <span
              className={cn(
                'mr-4 inline-block h-3 w-3 rounded-pill align-middle md:h-4 md:w-4',
                overall.dot,
              )}
              aria-hidden="true"
            />
            {overall.text}
          </h1>
          {data.description && (
            <p className="mt-5 max-w-[46ch] text-[15px] text-muted">{data.description}</p>
          )}
          <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-faint">
            <span>Updated {timeAgo(dataUpdatedAt, now)} · refreshes every 30 seconds</span>
            {data.includesSampleData && <SampleBadge />}
          </p>
        </div>
        {uptime != null && (
          <TickGauge
            value={uptimeGaugeProps(uptime).value}
            target={UPTIME_TARGET}
            warnTarget={UPTIME_WARN_TARGET}
            size={220}
            decimals={uptimeGaugeProps(uptime).decimals}
            label="Uptime"
            caption="last 90 days"
            ariaLabel={`${formatUptime(uptime)} percent uptime over the last 90 days`}
          />
        )}
      </div>

      <div className="relative -mx-5 mt-10 sm:-mx-8">
        <SignalFieldLazy {...signal} height={200} ariaLabel={`Signal field: ${overall.text}`} />
        <span className="pointer-events-none absolute right-5 bottom-2 text-[11px] text-faint sm:right-8">
          Live ↗
        </span>
      </div>

      {data.monitors.length > 0 && (
        <section className="mt-12" aria-label="Services">
          <h2 className="border-b border-line pb-3 text-[11px] text-faint">Services</h2>
          <ul className="divide-y divide-line">
            {data.monitors.map((monitor, i) => (
              <ComponentRow key={`${monitor.name}-${i}`} monitor={monitor} />
            ))}
          </ul>
          <div className="border-t border-line pt-3">
            <UptimeLegend />
          </div>
        </section>
      )}

      <section className="mt-16" aria-label="Past 30 days">
        <h2 className="border-b border-line pb-3 text-[11px] text-faint">Past 30 days</h2>
        {data.incidents.length === 0 ? (
          <p className="pt-6 text-sm text-muted">No incidents reported.</p>
        ) : (
          <ul className="relative mt-7 before:absolute before:top-2 before:bottom-2 before:left-[3.5px] before:w-px before:bg-line">
            {data.incidents.map((incident) => (
              <IncidentRow
                key={`${incident.monitorName}-${incident.startedAt}`}
                incident={incident}
                now={now}
              />
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
