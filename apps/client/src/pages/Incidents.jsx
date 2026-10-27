import { useSearchParams } from 'react-router-dom';
import { useIncidents } from '../api/incidents.js';
import IncidentCard from '../components/incidents/IncidentCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { PillGroup } from '../components/ui/Pill.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import { useNow } from '../hooks/useNow.js';

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

const PHRASE =
  'An incident opens after 3 consecutive failed checks and resolves after 2 successful ones.';

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

  // State-aware headline on the open tab; the plain name elsewhere.
  const total = pagination?.total;
  let headline = 'Incidents.';
  if (tab === 'open' && typeof total === 'number') {
    headline = total === 0 ? 'Nothing open.' : `${total} open.`;
  }

  return (
    <>
      <PageHeader title={headline} phrase={PHRASE} />

      <PillGroup
        label="Filter incidents"
        options={TABS}
        value={tab}
        onChange={(value) => go({ status: value })}
        className="mb-8"
      />

      {isError && <p className="text-sm text-status-down">Couldn&apos;t load incidents.</p>}

      {isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-card" />
          ))}
        </div>
      )}

      {incidents?.length === 0 && <EmptyState {...EMPTY[tab]} />}

      {incidents?.length > 0 && (
        <div className="border-t border-line">
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
          <span className="font-mono text-xs text-faint">
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
