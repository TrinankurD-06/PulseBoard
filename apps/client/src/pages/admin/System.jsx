import { RefreshCw } from 'lucide-react';
import { SYSTEM_REFRESH_MS, useAdminSystem } from '../../api/admin.js';
import {
  ErrorLine,
  Fact,
  Facts,
  LoadingRows,
  TextLink,
  When,
} from '../../components/admin/AdminBits.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import CodeChip from '../../components/ui/CodeChip.jsx';
import { useNow } from '../../hooks/useNow.js';
import {
  CHANNELS,
  alertFailuresTotal,
  apiState,
  changeStreamsState,
  errorLine,
  queueState,
  uptimeText,
  workerState,
} from '../../lib/adminConsole.js';
import { formatCount, timeAgo } from '../../lib/format.js';

function StatusCard({ title, state, children }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="font-medium text-fg">{title}</h2>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export default function System() {
  const now = useNow(5_000);
  const query = useAdminSystem();
  const { data } = query;

  const refresh = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-xs text-faint" aria-live="polite">
        {data ? `Updated ${timeAgo(query.dataUpdatedAt, now)}` : ''}
        {` · refreshes every ${SYSTEM_REFRESH_MS / 1000} seconds`}
      </p>
      <Button
        variant="secondary"
        size="sm"
        loading={query.isFetching}
        onClick={() => query.refetch()}
      >
        {!query.isFetching && <RefreshCw className="h-4 w-4" aria-hidden="true" />} Refresh
      </Button>
    </div>
  );

  const header = (
    <PageHeader
      title="System."
      phrase="Is everything running, and what has gone wrong lately."
      action={refresh}
    />
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <Card>
          <LoadingRows rows={5} />
        </Card>
      </>
    );
  }
  if (query.isError && !data) {
    return (
      <>
        {header}
        <Card>
          <ErrorLine error={query.error} what="the system status" />
        </Card>
      </>
    );
  }

  const { api, worker, queue, changeStreams, alertFailures, errors } = data;
  const worker_ = workerState(worker.status);
  const failuresTotal = alertFailuresTotal(alertFailures.last24h);

  return (
    <>
      {header}
      {query.isError && (
        <p role="alert" className="mb-6 text-sm text-status-down">
          The last refresh failed; showing the previous numbers.
        </p>
      )}
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <StatusCard title="API" state={apiState(api.status)}>
            <Facts cols={2}>
              <Fact label="Up for">{uptimeText(api.uptimeSec)}</Fact>
              <Fact label="Started">{when(api.startedAt)}</Fact>
            </Facts>
          </StatusCard>

          <StatusCard title="Worker" state={worker_}>
            <Facts cols={2}>
              <Fact label="Last run">
                <When value={worker.lastRunAt} now={now} empty="No run seen" />
              </Fact>
              <Fact label="What this means">
                {worker.status === 'running' && 'Recurring jobs are running on time.'}
                {worker.status === 'stale' && 'Recurring jobs have stopped for a while.'}
                {worker.status !== 'running' && worker.status !== 'stale' && 'No job activity yet.'}
              </Fact>
            </Facts>
          </StatusCard>

          <StatusCard title="Queue" state={queueState(queue)}>
            <Facts cols={2}>
              <Fact label="Pending">{formatCount(queue.pending)}</Fact>
              <Fact label="Running">{formatCount(queue.running)}</Fact>
              <Fact label="Failed">{formatCount(queue.failed)}</Fact>
              <Fact label="Oldest due">
                {queue.oldestDueAt ? (
                  <When value={queue.oldestDueAt} now={now} />
                ) : (
                  'Nothing waiting'
                )}
              </Fact>
            </Facts>
          </StatusCard>

          <StatusCard title="Change streams" state={changeStreamsState(changeStreams)}>
            <p className="text-sm text-muted">
              {changeStreams === 'live'
                ? 'Live updates are flowing from the database to open dashboards.'
                : `Reported state: ${changeStreams}. Dashboards may update more slowly.`}
            </p>
          </StatusCard>
        </div>

        <Card>
          <CardHeader
            title="Alert failures, last 24 hours"
            description={
              failuresTotal === 0
                ? 'No alert has failed to send.'
                : `${formatCount(failuresTotal)} failed in all.`
            }
          />
          <Facts cols={3} className="p-5">
            {CHANNELS.map(({ key, label }) => (
              <Fact key={key} label={label}>
                <span className="text-2xl font-light tabular-nums">
                  {formatCount(alertFailures.last24h?.[key] ?? 0)}
                </span>{' '}
                <span className="text-xs text-faint">failed</span>
              </Fact>
            ))}
          </Facts>
          <div className="border-t border-line">
            <h3 className="px-5 pt-4 text-xs text-faint">Most recent failures</h3>
            <DataTable
              caption="Recent alert failures"
              rows={alertFailures.recent.map((row, index) => ({
                ...row,
                id: `${row.at}-${index}`,
              }))}
              empty={{ title: 'No recent failures', description: 'Every alert was delivered.' }}
              columns={[
                {
                  key: 'at',
                  header: 'When',
                  primary: true,
                  cell: (row) => <When value={row.at} now={now} />,
                },
                {
                  key: 'channel',
                  header: 'Channel',
                  className: 'capitalize',
                  cell: (row) => row.channelType,
                },
                {
                  key: 'error',
                  header: 'Error',
                  wide: true,
                  cell: (row) => <span className="break-words">{row.error}</span>,
                },
                {
                  key: 'incident',
                  header: 'Incident',
                  cell: (row) =>
                    row.incidentId ? (
                      <TextLink to={`/app/admin/incidents/${row.incidentId}`}>Open</TextLink>
                    ) : (
                      <span className="text-faint">None</span>
                    ),
                },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent server errors"
            description="The newest 50 failed requests (status 500). No request bodies or headers are kept."
          />
          <DataTable
            caption="Recent server errors"
            rows={errors.map((row, index) => ({ ...row, id: `${row.at}-${index}` }))}
            empty={{ title: 'No server errors', description: 'Nothing has failed lately.' }}
            columns={[
              {
                key: 'at',
                header: 'When',
                primary: true,
                cell: (row) => <When value={row.at} now={now} />,
              },
              {
                key: 'request',
                header: 'Request',
                wide: true,
                cell: (row) => (
                  <span className="font-mono text-xs break-all">{errorLine(row)}</span>
                ),
              },
              {
                key: 'code',
                header: 'Code',
                cell: (row) =>
                  row.code ? (
                    <CodeChip>{row.code}</CodeChip>
                  ) : (
                    <span className="text-faint">None</span>
                  ),
              },
              {
                key: 'message',
                header: 'Message',
                wide: true,
                cell: (row) => <span className="break-words">{row.message}</span>,
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
