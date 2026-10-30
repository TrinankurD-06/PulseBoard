import { useAdminUsers } from '../../api/admin.js';
import { TextLink, When } from '../../components/admin/AdminBits.jsx';
import DataTable, { Pagination } from '../../components/admin/DataTable.jsx';
import { FilterBar, SearchBox, SelectFilter } from '../../components/admin/Filters.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { useNow } from '../../hooks/useNow.js';
import {
  accountStatus,
  platformRoleLabel,
  providersText,
  shortDate,
} from '../../lib/adminConsole.js';

const DEFAULTS = { search: '', status: 'all' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All users' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

/** The name, with the Demo tag next to it. */
export function UserName({ user }) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TextLink to={`/app/admin/users/${user.id}`} className="font-medium wrap-anywhere">
          {user.name || user.email}
        </TextLink>
        {user.isDemo && <Badge tone="amber">Demo</Badge>}
      </p>
      <p className="text-xs wrap-anywhere text-faint">{user.email}</p>
    </div>
  );
}

export default function Users() {
  const [params, set] = useListParams(DEFAULTS);
  const now = useNow();
  const query = useAdminUsers(params);
  const { data } = query;

  const columns = [
    { key: 'user', header: 'User', primary: true, cell: (row) => <UserName user={row} /> },
    { key: 'providers', header: 'Sign-in', cell: (row) => providersText(row.providers) },
    { key: 'created', header: 'Created', cell: (row) => shortDate(row.createdAt) },
    {
      key: 'lastLogin',
      header: 'Last login',
      cell: (row) => <When value={row.lastLoginAt} now={now} />,
    },
    {
      key: 'workspaces',
      header: 'Workspaces',
      className: 'text-right tabular-nums',
      cell: (row) => row.workspacesCount,
    },
    {
      key: 'monitors',
      header: 'Monitors',
      className: 'text-right tabular-nums',
      cell: (row) => row.monitorsCount,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => {
        const status = accountStatus(row);
        return <Badge tone={status.tone}>{status.label}</Badge>;
      },
    },
    { key: 'role', header: 'Role', cell: (row) => platformRoleLabel(row.platformRole) },
  ];

  return (
    <>
      <PageHeader
        title="Users."
        phrase="Everyone who has signed up. Open a user to act on their account."
      />
      <Card>
        <FilterBar>
          <SearchBox
            label="Search users"
            placeholder="Name or email"
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
          caption="Users"
          columns={columns}
          rows={data?.data}
          isPending={query.isPending}
          isFetching={query.isFetching}
          isError={query.isError}
          errorText="Couldn't load users."
          empty={{ title: 'No users found', description: 'Try a different name, email or status.' }}
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
