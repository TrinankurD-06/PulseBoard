import { ROLES } from '@pulseboard/shared/constants';
import { Activity, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSparklines } from '../api/analytics.js';
import { useIncidents } from '../api/incidents.js';
import { useMonitors } from '../api/monitors.js';
import MonitorCard from '../components/monitors/MonitorCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import { useNow } from '../hooks/useNow.js';
import { formatMs } from '../lib/format.js';

const newMonitorButtonClasses =
  'inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500';

function summarize(monitors) {
  const count = (status) => monitors.filter((m) => m.status === status).length;
  const responseTimes = monitors
    .filter((m) => !m.isPaused && m.lastResponseMs != null)
    .map((m) => m.lastResponseMs);
  const avgResponseMs = responseTimes.length
    ? responseTimes.reduce((sum, ms) => sum + ms, 0) / responseTimes.length
    : null;
  return { up: count('up'), down: count('down'), total: monitors.length, avgResponseMs };
}

function SummaryCard({ label, value, accent }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${accent ?? ''}`}>{value}</p>
    </Card>
  );
}

export default function Dashboard() {
  const { wid, workspace, can } = useCurrentWorkspace();
  const { data: monitors, isPending, isError } = useMonitors(wid);
  const { data: openIncidents } = useIncidents(wid, { status: 'open', limit: 1 });
  const openCount = openIncidents?.pagination.total;
  const { data: sparklines } = useSparklines(wid);
  const now = useNow();
  const canEdit = can(ROLES.MEMBER);

  const newButton = canEdit && (
    <Link to={`/app/${wid}/monitors/new`} className={newMonitorButtonClasses}>
      <Plus className="h-4 w-4" /> New monitor
    </Link>
  );

  const summary = monitors && summarize(monitors);

  return (
    <>
      <PageHeader
        title={workspace.name}
        description={
          summary
            ? `${summary.total} monitor${summary.total === 1 ? '' : 's'}`
            : 'All monitors at a glance'
        }
        action={newButton}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isPending
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[106px] rounded-xl" />)
          : summary && (
              <>
                <SummaryCard
                  label="Up"
                  value={summary.up}
                  accent="text-emerald-600 dark:text-emerald-400"
                />
                <SummaryCard
                  label="Down"
                  value={summary.down}
                  accent={summary.down > 0 ? 'text-red-600 dark:text-red-400' : undefined}
                />
                <Link
                  to={`/app/${wid}/incidents`}
                  className="rounded-xl focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
                >
                  <SummaryCard
                    label="Open incidents"
                    value={openCount ?? '—'}
                    accent={openCount > 0 ? 'text-red-600 dark:text-red-400' : undefined}
                  />
                </Link>
                <SummaryCard label="Avg response" value={formatMs(summary.avgResponseMs)} />
              </>
            )}
      </div>

      {isError && <p className="text-sm text-red-600">Couldn&apos;t load monitors.</p>}

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {monitors?.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No monitors yet"
          description={
            canEdit
              ? 'Add a URL to start checking its uptime and response time.'
              : 'Ask a workspace member to add the first monitor.'
          }
          action={newButton}
        />
      )}

      {monitors?.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {monitors.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              wid={wid}
              now={now}
              sparkline={sparklines?.[monitor.id]}
            />
          ))}
        </div>
      )}
    </>
  );
}
