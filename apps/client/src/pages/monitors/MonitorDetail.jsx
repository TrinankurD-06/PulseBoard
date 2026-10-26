import { ROLES } from '@pulseboard/shared/constants';
import { ArrowLeft, ExternalLink, FlaskConical, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useIncidents } from '../../api/incidents.js';
import {
  useDeleteMonitor,
  useMonitor,
  usePauseMonitor,
  useResumeMonitor,
  useTestSavedMonitor,
} from '../../api/monitors.js';
import IncidentCard from '../../components/incidents/IncidentCard.jsx';
import BudgetBanner from '../../components/monitors/BudgetBanner.jsx';
import MonitorAnalytics from '../../components/monitors/MonitorAnalytics.jsx';
import SslBadge from '../../components/monitors/SslBadge.jsx';
import StatusBadge from '../../components/monitors/StatusBadge.jsx';
import TestResult from '../../components/monitors/TestResult.jsx';
import TimingBar from '../../components/monitors/TimingBar.jsx';
import UsageCard from '../../components/monitors/UsageCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { useNow } from '../../hooks/useNow.js';
import { intervalDescription, isPausedByBudget } from '../../lib/budget.js';
import { formatMs, timeAgo } from '../../lib/format.js';
import NotFound from '../NotFound.jsx';

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{children}</dd>
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
              className="text-sm text-emerald-600 hover:underline"
            >
              View all
            </Link>
          )
        }
      />
      {incidents?.length === 0 && (
        <p className="p-5 text-sm text-slate-500">No incidents recorded for this monitor.</p>
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

function Actions({ monitor, wid, onTestResult }) {
  const navigate = useNavigate();
  const testNow = useTestSavedMonitor(wid, monitor.id);
  const pause = usePauseMonitor(wid, monitor.id);
  const resume = useResumeMonitor(wid, monitor.id);
  const remove = useDeleteMonitor(wid, monitor.id);

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
    if (!window.confirm(`Delete "${monitor.name}" and all of its check history?`)) return;
    try {
      await remove.mutateAsync();
      toast.success('Monitor deleted');
      navigate(`/app/${wid}`, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" loading={testNow.isPending} onClick={onTest}>
        {!testNow.isPending && <FlaskConical className="h-4 w-4" />} Test now
      </Button>
      {monitor.isPaused && isPausedByBudget(monitor) ? (
        // The API refuses (409 BUDGET_EXCEEDED) until the budget is raised.
        <Button
          variant="secondary"
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
          loading={resume.isPending}
          onClick={run(resume, 'Monitoring resumed')}
        >
          <Play className="h-4 w-4" /> Resume
        </Button>
      ) : (
        <Button
          variant="secondary"
          loading={pause.isPending}
          onClick={run(pause, 'Monitor paused')}
        >
          <Pause className="h-4 w-4" /> Pause
        </Button>
      )}
      <Link
        to={`/app/${wid}/monitors/${monitor.id}/edit`}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
      >
        <Pencil className="h-4 w-4" /> Edit
      </Link>
      <Button variant="danger" loading={remove.isPending} onClick={onDelete}>
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
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
  if (error) return <p className="text-sm text-red-600">Couldn&apos;t load this monitor.</p>;
  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const headerNames = Object.keys(monitor.headers ?? {});

  return (
    <div className="space-y-6">
      <Link
        to={`/app/${wid}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft className="h-4 w-4" /> All monitors
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{monitor.name}</h1>
            <StatusBadge status={monitor.status} />
            <SslBadge expiresAt={monitor.sslExpiresAt} now={now} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex max-w-full items-center gap-1 text-sm break-all text-slate-500 hover:text-emerald-600"
          >
            {monitor.method} {monitor.url} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        </div>
        {can(ROLES.MEMBER) && <Actions monitor={monitor} wid={wid} onTestResult={setTestResult} />}
      </div>

      <BudgetBanner wid={wid} monitor={monitor} canEdit={can(ROLES.MEMBER)} />

      {testResult && <TestResult result={testResult} />}

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
              <p className="p-5 text-sm text-slate-500">
                {monitor.isPaused ? 'Monitoring is paused.' : 'Waiting for the first check…'}
              </p>
            )}
          </Card>
        }
      />

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
