import { useAdminAudit } from '../../api/admin.js';
import { TextLink } from '../../components/admin/AdminBits.jsx';
import DataTable, { Pagination } from '../../components/admin/DataTable.jsx';
import {
  DateFilter,
  EntityFilter,
  FilterBar,
  SelectFilter,
} from '../../components/admin/Filters.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import {
  AUDIT_ACTIONS,
  TARGET_TYPES,
  actionLabel,
  auditSummaryText,
  dateRangeParams,
  targetTypeLabel,
} from '../../lib/adminConsole.js';

const DEFAULTS = {
  adminId: '',
  adminName: '',
  action: '',
  targetType: '',
  from: '',
  to: '',
};

const ACTION_OPTIONS = [
  { value: '', label: 'Any action' },
  ...AUDIT_ACTIONS.map((value) => ({ value, label: actionLabel(value) })),
];
const TARGET_OPTIONS = [
  { value: '', label: 'Any target' },
  ...TARGET_TYPES.map((value) => ({ value, label: targetTypeLabel(value) })),
];

/** Where a target leads: its admin page, when there is one. A monitor has none without its workspace. */
function targetPath(row) {
  switch (row.targetType) {
    case 'user':
      return `/app/admin/users/${row.targetId}`;
    case 'workspace':
      return `/app/admin/workspaces/${row.targetId}`;
    case 'incident':
      return `/app/admin/incidents/${row.targetId}`;
    default:
      return null;
  }
}

export default function AuditLog() {
  const [params, set] = useListParams(DEFAULTS);
  const range = dateRangeParams({ from: params.from, to: params.to });
  const query = useAdminAudit({
    adminId: params.adminId,
    action: params.action,
    targetType: params.targetType,
    from: range.from,
    to: range.to,
    page: params.page,
    limit: params.limit,
  });
  const { data } = query;

  const columns = [
    {
      key: 'at',
      header: 'When',
      primary: true,
      cell: (row) => (
        <time dateTime={row.at} className="text-fg">
          {new Date(row.at).toLocaleString()}
        </time>
      ),
    },
    {
      key: 'admin',
      header: 'Administrator',
      cell: (row) => <span className="wrap-anywhere">{row.adminEmail}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <span className="text-fg" title={row.action}>
          {actionLabel(row.action)}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      cell: (row) => {
        const path = targetPath(row);
        return (
          <div className="min-w-0">
            <p className="text-xs text-faint">{targetTypeLabel(row.targetType)}</p>
            {path ? (
              <TextLink to={path} className="font-mono text-xs break-all">
                {row.targetId}
              </TextLink>
            ) : (
              <span className="font-mono text-xs break-all">{row.targetId}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'details',
      header: 'Details',
      wide: true,
      cell: (row) => <span className="break-words">{auditSummaryText(row.summary) || '—'}</span>,
    },
    {
      key: 'ip',
      header: 'IP address',
      cell: (row) => <span className="font-mono text-xs">{row.ip || '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log."
        phrase="Every administrator action, and every time one looked at a user's data."
      />
      <Card>
        <FilterBar>
          <EntityFilter
            kind="users"
            label="Administrator"
            value={params.adminId ? { id: params.adminId, name: params.adminName } : null}
            onChange={(value) => set({ adminId: value?.id ?? '', adminName: value?.name ?? '' })}
          />
          <SelectFilter
            label="Action"
            value={params.action}
            options={ACTION_OPTIONS}
            onChange={(action) => set({ action })}
            className="col-span-2 w-full sm:col-span-1 sm:w-56"
          />
          <SelectFilter
            label="Target"
            value={params.targetType}
            options={TARGET_OPTIONS}
            onChange={(targetType) => set({ targetType })}
          />
          <DateFilter label="From" value={params.from} onChange={(from) => set({ from })} />
          <DateFilter label="To" value={params.to} onChange={(to) => set({ to })} />
        </FilterBar>
        <DataTable
          caption="Audit log"
          columns={columns}
          rows={data?.data}
          isPending={query.isPending}
          isFetching={query.isFetching}
          isError={query.isError}
          errorText="Couldn't load the audit log."
          empty={{ title: 'No entries', description: 'Nothing matches these filters.' }}
        />
        <Pagination
          pagination={data?.pagination}
          page={params.page}
          limit={params.limit}
          onPage={(page) => set({ page })}
        />
      </Card>
    </>
  );
}
