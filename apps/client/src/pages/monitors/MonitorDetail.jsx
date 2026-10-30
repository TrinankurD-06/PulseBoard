import { ROLES } from '@pulseboard/shared/constants';
import { Activity, ArrowLeft, Cpu, ExternalLink, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useUptime } from '../../api/analytics.js';
import { UPTIME_TARGET, UPTIME_WARN_TARGET, uptimeGaugeProps } from '../../lib/uptimeLevels.js';
import { errorMessage } from '../../api/http.js';
import { useConfirm } from '../../components/ui/confirmContext.js';
import { useIncidents } from '../../api/incidents.js';
import {
  useDeleteMonitor,
  useMonitor,
  usePauseMonitor,
  useResumeMonitor,
  useTestSavedMonitor,
} from '../../api/monitors.js';
import IncidentCard from '../../components/incidents/IncidentCard.jsx';
import AgentBanner from '../../components/monitors/AgentBanner.jsx';
import BudgetBanner from '../../components/monitors/BudgetBanner.jsx';
import HeartbeatStatusCard from '../../components/monitors/HeartbeatStatusCard.jsx';
import SslBadge from '../../components/monitors/SslBadge.jsx';
import StatusBadge from '../../components/monitors/StatusBadge.jsx';
import TestResult from '../../components/monitors/TestResult.jsx';
import TimingBar from '../../components/monitors/TimingBar.jsx';
import UsageCard from '../../components/monitors/UsageCard.jsx';
import TickGauge from '../../components/gauge/TickGauge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import LazyOnView from '../../components/ui/LazyOnView.jsx';
import RingDotCta from '../../components/ui/RingDotCta.jsx';
import SampleBadge from '../../components/ui/SampleBadge.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { useNow } from '../../hooks/useNow.js';
import { intervalDescription, isPausedByBudget } from '../../lib/budget.js';
import { formatDuration, formatMs, timeAgo } from '../../lib/format.js';
import { isAgent, isHeartbeat } from '../../lib/monitorType.js';
import NotFound from '../NotFound.jsx';

// The charts (and the chart library, the bulk of this page's JavaScript) load as
// their own chunks, so the title, gauge and actions paint without waiting for them.
// Every monitor type shows the Health deck, so its chunk starts downloading as soon as this
// page's code loads, in parallel with the monitor request, instead of after the data arrives
// (a lazy() component is otherwise only fetched at its first render).
const loadHealthDeck = () => import('../../components/health/HealthDeck.jsx');
loadHealthDeck();
const HealthDeck = lazy(loadHealthDeck);
const MonitorAnalytics = lazy(() => import('../../components/monitors/MonitorAnalytics.jsx'));
const AgentAnalytics = lazy(() => import('../../components/monitors/AgentAnalytics.jsx'));
const AgentSetup = lazy(() => import('../../components/monitors/AgentSetup.jsx'));
const HeartbeatSetup = lazy(() => import('../../components/monitors/HeartbeatSetup.jsx'));
const HeartbeatAnalytics = lazy(() => import('../../components/monitors/HeartbeatAnalytics.jsx'));

/**
 * A lazy chart section. `onView` also waits until the section is near the
 * viewport (for sections below the fold). The placeholder reserves `minHeight`.
 */
function Deferred({ minHeight, onView = false, children }) {
  const body = (
    <Suspense fallback={<div style={{ minHeight }} aria-hidden="true" />}>{children}</Suspense>
  );
  return onView ? <LazyOnView minHeight={minHeight}>{body}</LazyOnView> : body;
}

/** Back link, the monitor name as a display headline (URL or summary as the muted phrase), uptime gauge, actions. */
function MonitorHero({ wid, monitor, phrase, badges, actions }) {
  const { data: uptime } = useUptime(wid, monitor.id);
  // The 30-day figure from the API (confirmed downtime); no fallback to shorter windows.
  const gauge = uptimeGaugeProps(uptime?.d30);
  return (
    <>
      <Link
        to={`/app/${wid}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-faint transition-colors duration-200 hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All monitors
      </Link>

      <div className="grid items-center gap-10 lg:grid-cols-[1fr_minmax(0,17rem)]">
        <div className="min-w-0">
          <h1 className="text-[clamp(32px,4.5vw,56px)] leading-[1.05] font-light tracking-[-0.03em] break-words text-fg">
            {monitor.name}
          </h1>
          <div className="mt-3 text-sm text-muted">{phrase}</div>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">{badges}</div>
          {actions && <div className="mt-8">{actions}</div>}
        </div>
        {uptime ? (
          <div className="min-w-0">
            <TickGauge
              value={gauge.value}
              target={UPTIME_TARGET}
              warnTarget={UPTIME_WARN_TARGET}
              label="Uptime"
              caption="Last 30 days"
              decimals={gauge.decimals}
              size={272}
            />
            {uptime.includesSampleData && (
              <div className="mt-3 flex justify-center">
                <SampleBadge />
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto aspect-square w-full max-w-60" aria-hidden="true" />
        )}
      </div>
    </>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

function MonitorIncidents({ wid, monitorId, now }) {
  const { data } = useIncidents(wid, { monitorId, limit: 5 });
  const incidents = data?.data;
  return (
    <Card>
      <CardHeader
        title="Incidents"
        action={
          data?.pagination.total > 5 && (
            <Link
              to={`/app/${wid}/incidents?status=all`}
              className="text-sm text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg"
            >
              View all
            </Link>
          )
        }
      />
      {incidents?.length === 0 && (
        <p className="p-5 text-sm text-muted">No incidents recorded for this monitor.</p>
      )}
      {incidents?.length > 0 && (
        <div className="space-y-3 p-5">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              wid={wid}
              now={now}
              showMonitor={false}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function Actions({ monitor, wid, onTestResult, canTest = true }) {
  const navigate = useNavigate();
  const testNow = useTestSavedMonitor(wid, monitor.id);
  const pause = usePauseMonitor(wid, monitor.id);
  const resume = useResumeMonitor(wid, monitor.id);
  const remove = useDeleteMonitor(wid, monitor.id);
  const confirm = useConfirm();

  const run = (mutation, message) => async () => {
    try {
      await mutation.mutateAsync();
      toast.success(message);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  async function onTest() {
    onTestResult(null);
    try {
      onTestResult(await testNow.mutateAsync());
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onDelete() {
    const confirmed = await confirm({
      title: 'Delete monitor',
      message: `Delete "${monitor.name}" and all of its check history? This can't be undone.`,
      confirmLabel: 'Delete monitor',
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      toast.success('Monitor deleted');
      navigate(`/app/${wid}`, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      {canTest && (
        <RingDotCta loading={testNow.isPending} onClick={onTest}>
          Test now
        </RingDotCta>
      )}
      {monitor.isPaused && isPausedByBudget(monitor) ? (
        // The API refuses (409 BUDGET_EXCEEDED) until the budget is raised.
        <Button
          variant="secondary"
          size="sm"
          disabled
          title="Paused by the monthly request budget: raise the budget to resume"
          aria-describedby="resume-budget-note"
        >
          <Play className="h-4 w-4" /> Resume
          <span id="resume-budget-note" className="sr-only">
            Paused by the monthly request budget: raise the budget to resume
          </span>
        </Button>
      ) : monitor.isPaused ? (
        <Button
          variant="secondary"
          size="sm"
          loading={resume.isPending}
          onClick={run(resume, 'Monitoring resumed')}
        >
          <Play className="h-4 w-4" /> Resume
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          loading={pause.isPending}
          onClick={run(pause, 'Monitor paused')}
        >
          <Pause className="h-4 w-4" /> Pause
        </Button>
      )}
      <Link
        to={`/app/${wid}/monitors/${monitor.id}/edit`}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-pill border border-line-strong px-3.5 text-[13px] font-medium whitespace-nowrap text-fg transition-colors duration-200 ease-(--ease) hover:border-fg hover:bg-surface-2"
      >
        <Pencil className="h-4 w-4" /> Edit
      </Link>
      <Button variant="danger" size="sm" loading={remove.isPending} onClick={onDelete}>
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    </div>
  );
}

/**
 * Heartbeat monitors: the customer's job pings us, so there is no URL to
 * check, no response-time/timing charts and no cost or budget. Instead: the
 * ping URL with snippets, live "last ping / next expected", ping history.
 */
function HeartbeatDetail({ monitor, wid, canEdit, now }) {
  return (
    <div className="space-y-10">
      <MonitorHero
        wid={wid}
        monitor={monitor}
        phrase={
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Heartbeat · expects a ping every {formatDuration(monitor.expectedEverySec)}
            {monitor.graceSec ? ` (+${formatDuration(monitor.graceSec)} grace)` : ''}
          </span>
        }
        badges={<StatusBadge status={monitor.status} />}
        actions={canEdit && <Actions monitor={monitor} wid={wid} canTest={false} />}
      />

      <Deferred minHeight="44rem">
        <HealthDeck wid={wid} monitorId={monitor.id} />
      </Deferred>

      <Deferred minHeight="30rem" onView>
        <HeartbeatAnalytics
          wid={wid}
          monitorId={monitor.id}
          side={<HeartbeatStatusCard wid={wid} monitor={monitor} now={now} />}
        />
      </Deferred>

      <Deferred minHeight="24rem" onView>
        <HeartbeatSetup wid={wid} monitor={monitor} canEdit={canEdit} />
      </Deferred>

      <MonitorIncidents wid={wid} monitorId={monitor.id} now={now} />
    </div>
  );
}

/**
 * Agent monitors: the customer's app reports aggregated metrics to us. Live
 * reporting state, charts from the reports, top routes, the key/snippets and
 * the usual uptime, 90-day bars and incidents. "Test now" probes the probe URL,
 * so it's only offered when one is set.
 */
function AgentDetail({ monitor, wid, canEdit, now }) {
  const [testResult, setTestResult] = useState(null);
  return (
    <div className="space-y-10">
      <MonitorHero
        wid={wid}
        monitor={monitor}
        phrase={
          <span className="inline-flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            App agent · reports every {formatDuration(monitor.reportEverySec)}
          </span>
        }
        badges={<StatusBadge status={monitor.status} />}
        actions={
          canEdit && (
            <Actions
              monitor={monitor}
              wid={wid}
              onTestResult={setTestResult}
              canTest={Boolean(monitor.probeUrl)}
            />
          )
        }
      />

      <Deferred minHeight="44rem">
        <HealthDeck wid={wid} monitorId={monitor.id} />
      </Deferred>

      <AgentBanner monitor={monitor} now={now} />

      {testResult && <TestResult result={testResult} />}

      <Deferred minHeight="40rem" onView>
        <AgentAnalytics wid={wid} monitor={monitor} now={now} />
      </Deferred>

      <Deferred minHeight="24rem" onView>
        <AgentSetup wid={wid} monitor={monitor} canEdit={canEdit} />
      </Deferred>

      <MonitorIncidents wid={wid} monitorId={monitor.id} now={now} />
    </div>
  );
}

export default function MonitorDetail() {
  const { wid, can } = useCurrentWorkspace();
  const { mid } = useParams();
  const { data: monitor, isPending, error } = useMonitor(wid, mid);
  const now = useNow();
  const [testResult, setTestResult] = useState(null);
  useDocumentTitle(monitor?.name);

  if (error?.response?.status === 404) return <NotFound message="This monitor doesn't exist." />;
  if (error) return <p className="text-sm text-status-down">Couldn&apos;t load this monitor.</p>;
  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-48 rounded-card" />
      </div>
    );
  }

  if (isHeartbeat(monitor)) {
    return <HeartbeatDetail monitor={monitor} wid={wid} canEdit={can(ROLES.MEMBER)} now={now} />;
  }
  if (isAgent(monitor)) {
    return <AgentDetail monitor={monitor} wid={wid} canEdit={can(ROLES.MEMBER)} now={now} />;
  }

  const headerNames = Object.keys(monitor.headers ?? {});

  return (
    <div className="space-y-10">
      <MonitorHero
        wid={wid}
        monitor={monitor}
        phrase={
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 font-mono text-[13px] break-all text-muted transition-colors hover:text-fg"
          >
            {monitor.method} {monitor.url} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        }
        badges={
          <>
            <StatusBadge status={monitor.status} />
            <SslBadge expiresAt={monitor.sslExpiresAt} now={now} />
          </>
        }
        actions={
          can(ROLES.MEMBER) && <Actions monitor={monitor} wid={wid} onTestResult={setTestResult} />
        }
      />

      <Deferred minHeight="44rem">
        <HealthDeck wid={wid} monitorId={monitor.id} />
      </Deferred>

      <BudgetBanner wid={wid} monitor={monitor} canEdit={can(ROLES.MEMBER)} />

      {testResult && <TestResult result={testResult} />}

      <Deferred minHeight="60rem" onView>
        <MonitorAnalytics
          wid={wid}
          monitorId={monitor.id}
          latestCheckCard={
            <Card>
              <CardHeader title="Latest check" />
              {monitor.lastCheckedAt ? (
                <dl className="grid grid-cols-2 gap-4 p-5">
                  <Detail label="Checked">{timeAgo(monitor.lastCheckedAt, now)}</Detail>
                  <Detail label="Result">{monitor.lastOk ? 'Passed' : 'Failed'}</Detail>
                  <Detail label="Response time">{formatMs(monitor.lastResponseMs)}</Detail>
                  <Detail label="Status code">{monitor.lastStatusCode ?? '—'}</Detail>
                  {monitor.lastError && <Detail label="Error">{monitor.lastError}</Detail>}
                  {monitor.lastTimings && (
                    <div className="col-span-2">
                      <TimingBar timings={monitor.lastTimings} />
                    </div>
                  )}
                </dl>
              ) : (
                <p className="p-5 text-sm text-muted">
                  {monitor.isPaused ? 'Monitoring is paused.' : 'Waiting for the first check…'}
                </p>
              )}
            </Card>
          }
        />
      </Deferred>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Configuration" />
          <dl className="grid grid-cols-2 gap-4 p-5">
            <Detail label="Method">
              {monitor.method === 'HEAD' && monitor.headUnsupported
                ? "GET (server doesn't support HEAD)"
                : monitor.method}
            </Detail>
            <Detail label="Interval">{intervalDescription(monitor, now)}</Detail>
            <Detail label="Timeout">{formatMs(monitor.timeoutMs)}</Detail>
            <Detail label="Expected status">
              {monitor.expectedStatus.min}–{monitor.expectedStatus.max}
            </Detail>
            <Detail label="Keyword">{monitor.keyword ? `"${monitor.keyword}"` : 'None'}</Detail>
            <Detail label="Custom headers">
              {headerNames.length ? headerNames.join(', ') : 'None'}
            </Detail>
          </dl>
        </Card>
        <UsageCard wid={wid} monitorId={monitor.id} />
      </div>

      <MonitorIncidents wid={wid} monitorId={monitor.id} now={now} />
    </div>
  );
}
