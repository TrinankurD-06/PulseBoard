import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useIncidents } from '../api/incidents.js';
import IncidentCard from '../components/incidents/IncidentCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import { useNow } from '../hooks/useNow.js';
import { cn } from '../lib/cn.js';

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const EMPTY = {
  open: { title: 'No open incidents', description: 'All monitors are operating normally.' },
  resolved: { title: 'No resolved incidents yet', description: 'Past outages will appear here.' },
  all: { title: 'No incidents yet', description: 'Incidents open after 3 failed checks in a row.' },
};

export default function Incidents() {
  const { wid } = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('status')) ? params.get('status') : 'open';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const now = useNow(1000);

  const { data, isPending, isError } = useIncidents(wid, {
    status: tab === 'all' ? undefined : tab,
    page,
  });
  const incidents = data?.data;
  const pagination = data?.pagination;

  const go = (next) => setParams({ status: next.status ?? tab, page: String(next.page ?? 1) });

  return (
    <>
      <PageHeader
        title="Incidents"
        description="An incident opens after 3 consecutive failed checks and resolves after 2 successful ones."
      />

      <div
        role="tablist"
        className="mb-6 inline-flex rounded-lg border border-slate-200 p-1 dark:border-slate-800"
      >
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={tab === t.value}
            onClick={() => go({ status: t.value })}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t.value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isError && <p className="text-sm text-red-600">Couldn&apos;t load incidents.</p>}

      {isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {incidents?.length === 0 && <EmptyState icon={CheckCircle2} {...EMPTY[tab]} />}

      {incidents?.length > 0 && (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} wid={wid} now={now} />
          ))}
        </div>
      )}

      {pagination?.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-sm">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => go({ page: page - 1 })}
          >
            Previous
          </Button>
          <span className="text-slate-500">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pagination.totalPages}
            onClick={() => go({ page: page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
