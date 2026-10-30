import { useAdminWorkspaces } from '../../api/admin.js';
import { TextLink } from '../../components/admin/AdminBits.jsx';
import DataTable, { Pagination } from '../../components/admin/DataTable.jsx';
import { FilterBar, SearchBox, SelectFilter } from '../../components/admin/Filters.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { accountStatus, shortDate } from '../../lib/adminConsole.js';

const DEFAULTS = { search: '', status: 'all' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All workspaces' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

export default function Workspaces() {
  const [params, set] = useListParams(DEFAULTS);
  const query = useAdminWorkspaces(params);
  const { data } = query;

  const columns = [
    {
      key: 'name',
      header: 'Workspace',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <TextLink to={`/app/admin/workspaces/${row.id}`} className="font-medium wrap-anywhere">
            {row.name}
          </TextLink>
          <p className="text-xs wrap-anywhere text-faint">{row.slug}</p>
        </div>
      ),
    },
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
    { key: 'created', header: 'Created', cell: (row) => shortDate(row.createdAt) },
    {
      key: 'members',
      header: 'Members',
      className: 'text-right tabular-nums',
      cell: (row) => row.membersCount,
    },
    {
      key: 'monitors',
      header: 'Monitors',
      className: 'text-right tabular-nums',
      cell: (row) => row.monitorsCount,
    },
    {
      key: 'incidents',
      header: 'Open incidents',
      className: 'text-right tabular-nums',
      cell: (row) => row.openIncidents,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => {
        const status = accountStatus(row);
        return <Badge tone={status.tone}>{status.label}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Workspaces."
        phrase="Every workspace, its owner and what is running in it."
      />
      <Card>
        <FilterBar>
          <SearchBox
            label="Search workspaces"
            placeholder="Name or slug"
            value={params.search}
            onSearch={(search) => set({ search })}
          />
          <SelectFilter
            label="Status"
            value={params.status}
            options={STATUS_OPTIONS}
            onChange={(status) => set({ status })}
          />
        </FilterBar>
        <DataTable
          caption="Workspaces"
          columns={columns}
          rows={data?.data}
          isPending={query.isPending}
          isFetching={query.isFetching}
          isError={query.isError}
          errorText="Couldn't load workspaces."
          empty={{ title: 'No workspaces found', description: 'Try a different name or status.' }}
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
