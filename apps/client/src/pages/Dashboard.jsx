import { ROLES } from '@pulseboard/shared/constants';
import { Link } from 'react-router-dom';
import { useSparklines, useUptimeSummary } from '../api/analytics.js';
import { useAuth } from '../auth/AuthContext.js';
import { useIncidents } from '../api/incidents.js';
import { useMonitors } from '../api/monitors.js';
import { useAmbientAlertSignal } from '../components/ambient/ambientStore.js';
import TickGauge from '../components/gauge/TickGauge.jsx';
import MonitorCard from '../components/monitors/MonitorCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SignalFieldLazy from '../components/signal/SignalFieldLazy.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import RingDotCta from '../components/ui/RingDotCta.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import SteppedCards from '../components/ui/SteppedCards.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import { useNow } from '../hooks/useNow.js';
import { useSignalFeed } from '../hooks/useSignalFeed.js';
import { formatDuration, formatMs } from '../lib/format.js';
import { isOperational } from '../lib/status.js';
import { UPTIME_TARGET, UPTIME_WARN_TARGET, uptimeGaugeProps } from '../lib/uptimeLevels.js';

function summarize(monitors) {
  const count = (status) => monitors.filter((m) => m.status === status).length;
  const responseTimes = monitors
    // Only checks we send: a heartbeat 'response' is a job's run duration and
    // an agent's is its app-side p50, not a response time we measured.
    .filter((m) => !m.isPaused && (m.type ?? 'http') === 'http' && m.lastResponseMs != null)
    .map((m) => m.lastResponseMs);
  const avgResponseMs = responseTimes.length
    ? responseTimes.reduce((sum, ms) => sum + ms, 0) / responseTimes.length
    : null;
  const intervals = monitors
    .filter((m) => !m.isPaused && (m.type ?? 'http') === 'http' && m.intervalSec > 0)
    .map((m) => m.intervalSec);
  return {
    up: monitors.filter((m) => isOperational(m.status)).length,
    down: count('down'),
    total: monitors.length,
    avgResponseMs,
    fastestIntervalSec: intervals.length ? Math.min(...intervals) : null,
  };
}

function headline(summary) {
  if (!summary) return 'Overview.';
  if (summary.down === 0) return 'All quiet.';
  return `${summary.down} monitor${summary.down === 1 ? ' needs' : 's need'} attention.`;
}

export default function Dashboard() {
  const { wid, workspace, can } = useCurrentWorkspace();
  const { data: monitors, isPending, isError } = useMonitors(wid);
  const { data: openIncidents } = useIncidents(wid, { status: 'open', limit: 1 });
  const openCount = openIncidents?.pagination.total;
  const { data: sparklines } = useSparklines(wid);
  // Confirmed-downtime uptime from the API; never derived from passed checks here.
  const { data: uptimeSummary, isPending: summaryPending } = useUptimeSummary(wid, 30);
  const signal = useSignalFeed(wid);
  const now = useNow();
  const canEdit = can(ROLES.MEMBER);
  const { user } = useAuth();
  // Only people who signed in with GitHub can read their repos.
  const canImport = canEdit && Boolean(user?.providers?.includes('github'));

  const summary = monitors?.length ? summarize(monitors) : null;
  useAmbientAlertSignal((summary?.down ?? 0) > 0);

  const newButton = canEdit && <RingDotCta to={`/app/${wid}/monitors/new`}>New monitor</RingDotCta>;
  const importButton = canImport && (
    <RingDotCta to={`/app/${wid}/import/github`}>Import from GitHub</RingDotCta>
  );
  const actions = (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
      {importButton}
      {newButton}
    </div>
  );
  const uptime = uptimeSummary?.uptime ?? null;
  const gauge = uptimeGaugeProps(uptime);
  const side = monitors
    ? `${workspace.name} · ${monitors.length} monitor${monitors.length === 1 ? '' : 's'}`
    : workspace.name;

  return (
    <>
      <PageHeader title={headline(summary)} phrase={side} action={canEdit ? actions : undefined} />

      {isError && <p className="text-sm text-status-down">Couldn&apos;t load monitors.</p>}

      {isPending && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <Skeleton className="mx-auto aspect-square w-full max-w-72 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      )}

      {monitors?.length === 0 && (
        <EmptyState
          title="No monitors yet"
          description={
            canEdit
              ? 'Add a URL to start checking its uptime and response time.'
              : 'Ask a workspace member to add the first monitor.'
          }
          action={canEdit ? actions : undefined}
        />
      )}

      {summary && (
        <>
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-12">
            <TickGauge
              value={gauge.value}
              target={UPTIME_TARGET}
              warnTarget={UPTIME_WARN_TARGET}
              label="Uptime"
              caption={
                uptime == null ? 'Nothing has been covered yet' : 'Last 30 days, all monitors'
              }
              decimals={gauge.decimals}
              emptyText={summaryPending ? '…' : 'No data yet'}
              size={300}
            />
            <div>
              <SteppedCards
                items={[
                  {
                    value: summary.up,
                    label: 'Up',
                    description: `of ${summary.total} monitor${summary.total === 1 ? '' : 's'} answering normally.`,
                  },
                  {
                    value: summary.down,
                    label: 'Down',
                    description:
                      summary.down > 0
                        ? 'Not answering right now. Open one for detail.'
                        : 'Nothing is failing.',
                  },
                  {
                    value: openCount ?? 0,
                    label: 'Open incidents',
                    description:
                      openCount > 0 ? 'Waiting to be resolved.' : 'No incidents are open.',
                  },
                ]}
              />
              <p className="mt-4 text-right text-[11px] text-faint">
                <Link
                  to={`/app/${wid}/incidents`}
                  className="underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg"
                >
                  View incidents
                </Link>
              </p>
            </div>
          </div>

          <div className="relative mt-12">
            <SignalFieldLazy
              {...signal}
              height={220}
              ariaLabel={
                summary.down > 0
                  ? `Live signal: ${summary.down} of ${summary.total} monitors down`
                  : `Live signal: all ${summary.total} monitors up`
              }
            />
            <p className="pointer-events-none absolute top-0 left-0 text-[11px] text-faint">
              {summary.fastestIntervalSec
                ? `Checks every ${formatDuration(summary.fastestIntervalSec)}`
                : 'Waiting for checks'}
              {summary.avgResponseMs != null && ` · avg ${formatMs(summary.avgResponseMs)}`}
            </p>
            <p className="pointer-events-none absolute top-0 right-0 text-[11px] text-faint">
              Live ↗
            </p>
          </div>

          <section className="mt-12" aria-label="Monitors">
            {monitors.map((monitor) => (
              <MonitorCard
                key={monitor.id}
                monitor={monitor}
                wid={wid}
                now={now}
                sparkline={sparklines?.[monitor.id]}
              />
            ))}
          </section>
        </>
      )}
    </>
  );
}
