import { ExternalLink, Pause, Play, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useAdminMonitors,
  useBulkMonitors,
  useDeleteAdminMonitor,
  usePauseAdminMonitor,
  useResumeAdminMonitor,
  useTestAdminMonitor,
} from '../../api/admin.js';
import { errorMessage } from '../../api/http.js';
import { TextLink } from '../../components/admin/AdminBits.jsx';
import DataTable, { Pagination } from '../../components/admin/DataTable.jsx';
import {
  EntityFilter,
  FilterBar,
  SearchBox,
  SelectFilter,
  ToggleFilter,
} from '../../components/admin/Filters.jsx';
import ReasonDialog from '../../components/admin/ReasonDialog.jsx';
import { LastCheck, MonitorName, MonitorState } from '../../components/admin/Tables.jsx';
import TypedConfirmDialog from '../../components/admin/TypedConfirmDialog.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { useNow } from '../../hooks/useNow.js';
import {
  BULK_MAX,
  MONITOR_STATUSES,
  MONITOR_TYPES,
  bulkResultMessage,
  canPause,
  monitorTypeLabel,
  testResultMessage,
  toggleId,
  togglePage,
} from '../../lib/adminConsole.js';
import { statusStyle } from '../../lib/status.js';
import { cn } from '../../lib/cn.js';

const DEFAULTS = {
  search: '',
  status: '',
  type: '',
  workspaceId: '',
  workspaceName: '',
  ownerId: '',
  ownerName: '',
  failing: '',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  ...MONITOR_STATUSES.map((value) => ({ value, label: statusStyle(value).label })),
];
const TYPE_OPTIONS = [
  { value: '', label: 'Any type' },
  ...MONITOR_TYPES.map((value) => ({ value, label: monitorTypeLabel(value) })),
];

const iconButton =
  'inline-flex h-8 w-8 items-center justify-center rounded-pill border border-line text-muted transition-colors duration-200 hover:border-line-strong hover:text-fg disabled:opacity-50';

/** One monitor's actions: icon buttons with names on a wide table, text buttons in a phone card. */
function RowActions({ row, labels, onPause, onDelete, busy }) {
  const resume = useResumeAdminMonitor();
  const test = useTestAdminMonitor();
  const paused = !canPause(row);

  async function onResume() {
    try {
      await resume.mutateAsync({ id: row.id });
      toast.success(`Resumed ${row.name}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onTest() {
    try {
      const result = await test.mutateAsync({ id: row.id });
      const message = `${row.name}: ${testResultMessage(result)}`;
      if (result?.ok) toast.success(message);
      else toast.error(message);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const items = [
    {
      key: 'toggle',
      label: paused ? 'Resume' : 'Pause',
      icon: paused ? Play : Pause,
      onClick: paused ? onResume : () => onPause(row),
      loading: resume.isPending,
    },
    { key: 'test', label: 'Test now', icon: Zap, onClick: onTest, loading: test.isPending },
    { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => onDelete(row), danger: true },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
      {items.map(({ key, label, icon: Icon, onClick, loading, danger }) =>
        labels ? (
          <Button
            key={key}
            variant={danger ? 'danger' : 'secondary'}
            size="sm"
            loading={loading}
            disabled={busy}
            onClick={onClick}
            aria-label={`${label} ${row.name}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" /> {label}
          </Button>
        ) : (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={`${label} ${row.name}`}
            disabled={loading || busy}
            onClick={onClick}
            className={cn(iconButton, danger && 'hover:border-status-down hover:text-status-down')}
          >
            <Icon className={cn('h-4 w-4', loading && 'animate-pulse')} aria-hidden="true" />
          </button>
        ),
      )}
      <Link
        to={`/app/${row.workspace.id}/monitors/${row.id}`}
        title="Open the read-only monitor page"
        aria-label={`Open ${row.name}`}
        className={
          labels
            ? 'inline-flex h-8 items-center gap-2 rounded-pill border border-line-strong px-3.5 text-[13px] font-medium text-fg hover:border-fg hover:bg-surface-2'
            : iconButton
        }
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        {labels && 'Open'}
      </Link>
    </div>
  );
}

export default function Monitors() {
  const [params, set] = useListParams(DEFAULTS);
  const now = useNow();
  const query = useAdminMonitors({
    search: params.search,
    status: params.status,
    type: params.type,
    workspaceId: params.workspaceId,
    ownerId: params.ownerId,
    failing: params.failing === 'true',
    page: params.page,
    limit: params.limit,
  });
  const { data } = query;

  const pause = usePauseAdminMonitor();
  const remove = useDeleteAdminMonitor();
  const bulk = useBulkMonitors();

  const [selected, setSelected] = useState(() => new Set());
  // null | { kind: 'pause', row } | { kind: 'delete', row } | { kind: 'bulk-pause' } | { kind: 'bulk-delete' }
  const [dialog, setDialog] = useState(null);
  const close = () => setDialog(null);
  const rows = data?.data ?? [];
  const count = selected.size;
  const tooMany = count > BULK_MAX;

  async function runBulk(action, extra = {}) {
    const result = await bulk.mutateAsync({ action, ids: [...selected], ...extra });
    const message = bulkResultMessage(action, result);
    if (result.failed?.length) toast.warning(message);
    else toast.success(message);
    setSelected(new Set());
  }

  async function onBulkResume() {
    try {
      await runBulk('resume');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const columns = [
    { key: 'name', header: 'Monitor', primary: true, cell: (row) => <MonitorName row={row} /> },
    {
      key: 'owner',
      header: 'Owner',
      cell: (row) => (
        <div className="min-w-0">
          <TextLink to={`/app/admin/users/${row.owner.id}`} className="wrap-anywhere text-muted">
            {row.owner.name || row.owner.email}
          </TextLink>
          <p className="text-xs wrap-anywhere text-faint">{row.owner.email}</p>
        </div>
      ),
    },
    {
      key: 'workspace',
      header: 'Workspace',
      cell: (row) => (
        <TextLink
          to={`/app/admin/workspaces/${row.workspace.id}`}
          className="wrap-anywhere text-muted"
        >
          {row.workspace.name}
        </TextLink>
      ),
    },
    { key: 'type', header: 'Type', cell: (row) => monitorTypeLabel(row.type) },
    { key: 'state', header: 'State', cell: (row) => <MonitorState row={row} /> },
    { key: 'last', header: 'Last check', cell: (row) => <LastCheck row={row} now={now} /> },
    {
      key: 'actions',
      header: 'Actions',
      wide: true,
      cell: (row) => (
        <RowActions
          row={row}
          onPause={(r) => setDialog({ kind: 'pause', row: r })}
          onDelete={(r) => setDialog({ kind: 'delete', row: r })}
        />
      ),
      mobile: (row) => (
        <RowActions
          row={row}
          labels
          onPause={(r) => setDialog({ kind: 'pause', row: r })}
          onDelete={(r) => setDialog({ kind: 'delete', row: r })}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Monitors."
        phrase="Every monitor on the platform. Open one to see exactly what its owner sees, read-only."
      />
      <Card>
        <FilterBar>
          <SearchBox
            label="Search monitors"
            placeholder="Name or URL"
            value={params.search}
            onSearch={(search) => set({ search })}
          />
          <SelectFilter
            label="Status"
            value={params.status}
            options={STATUS_OPTIONS}
            onChange={(status) => set({ status })}
          />
          <SelectFilter
            label="Type"
            value={params.type}
            options={TYPE_OPTIONS}
            onChange={(type) => set({ type })}
          />
          <EntityFilter
            kind="workspaces"
            label="Workspace"
            value={
              params.workspaceId ? { id: params.workspaceId, name: params.workspaceName } : null
            }
            onChange={(value) =>
              set({ workspaceId: value?.id ?? '', workspaceName: value?.name ?? '' })
            }
          />
          <EntityFilter
            kind="users"
            label="Owner"
            value={params.ownerId ? { id: params.ownerId, name: params.ownerName } : null}
            onChange={(value) => set({ ownerId: value?.id ?? '', ownerName: value?.name ?? '' })}
          />
          <ToggleFilter
            label="Failing now"
            checked={params.failing === 'true'}
            onChange={(checked) => set({ failing: checked ? 'true' : '' })}
          />
        </FilterBar>

        {count > 0 && (
          <div
            role="region"
            aria-label="Bulk actions"
            className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-5 py-3"
          >
            <p className="mr-2 text-sm text-fg" aria-live="polite">
              {count} selected
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={tooMany}
              onClick={() => setDialog({ kind: 'bulk-pause' })}
            >
              <Pause className="h-4 w-4" aria-hidden="true" /> Pause
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={tooMany}
              loading={bulk.isPending && dialog === null}
              onClick={onBulkResume}
            >
              <Play className="h-4 w-4" aria-hidden="true" /> Resume
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={tooMany}
              onClick={() => setDialog({ kind: 'bulk-delete' })}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            {tooMany && (
              <p className="basis-full text-xs text-status-down">
                Bulk actions take up to {BULK_MAX} monitors at a time. Clear some rows.
              </p>
            )}
          </div>
        )}

        <DataTable
          caption="Monitors"
          columns={columns}
          rows={data?.data}
          isPending={query.isPending}
          isFetching={query.isFetching}
          isError={query.isError}
          errorText="Couldn't load monitors."
          empty={{ title: 'No monitors found', description: 'Try removing a filter.' }}
          selected={selected}
          onToggleRow={(id) => setSelected((current) => toggleId(current, id))}
          onTogglePage={() => setSelected((current) => togglePage(rows, current))}
          selectLabel={(row) => `Select ${row.name}`}
        />
        <Pagination
          pagination={data?.pagination}
          page={params.page}
          limit={params.limit}
          onPage={(page) => set({ page })}
        />
      </Card>

      <ReasonDialog
        open={dialog?.kind === 'pause' || dialog?.kind === 'bulk-pause'}
        title={
          dialog?.kind === 'bulk-pause'
            ? `Pause ${count} monitors`
            : `Pause ${dialog?.row?.name ?? ''}`
        }
        description={
          <p>
            Checks and alerts stop. The owner sees that an administrator paused it, with your note,
            and cannot resume it.
          </p>
        }
        label="Note for the owner"
        hint="Shown on the monitor page."
        required={false}
        submitLabel="Pause"
        tone="primary"
        onCancel={close}
        onSubmit={async (note) => {
          if (dialog.kind === 'bulk-pause') {
            await runBulk('pause', { note });
          } else {
            await pause.mutateAsync({ id: dialog.row.id, note });
            toast.success(`Paused ${dialog.row.name}`);
          }
          close();
        }}
      />

      <TypedConfirmDialog
        open={dialog?.kind === 'delete'}
        title="Delete this monitor"
        requiredText={dialog?.row?.name ?? ''}
        inputLabel="Type the monitor name to confirm"
        confirmLabel="Delete monitor"
        onCancel={close}
        onConfirm={async () => {
          await remove.mutateAsync({ id: dialog.row.id, confirm: dialog.row.name });
          toast.success(`Deleted ${dialog.row.name}`);
          setSelected((current) => {
            const next = new Set(current);
            next.delete(dialog.row.id);
            return next;
          });
          close();
        }}
        consequences={
          <p>
            This permanently deletes{' '}
            <strong className="font-medium wrap-anywhere text-fg">{dialog?.row?.name}</strong> and
            its whole check history, for {dialog?.row?.owner?.name || dialog?.row?.owner?.email}. It
            cannot be undone.
          </p>
        }
      />

      <TypedConfirmDialog
        open={dialog?.kind === 'bulk-delete'}
        title={`Delete ${count} monitors`}
        requiredText="DELETE"
        inputLabel="Type DELETE to confirm"
        confirmLabel={`Delete ${count} monitors`}
        onCancel={close}
        onConfirm={async () => {
          await runBulk('delete', { confirm: 'DELETE' });
          close();
        }}
        consequences={
          <p>
            This permanently deletes the {count} selected monitors and all of their check history.
            It cannot be undone.
          </p>
        }
      />
    </>
  );
}
