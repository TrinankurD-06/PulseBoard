import { useAdminIncidents } from '../../api/admin.js';
import { Pagination } from '../../components/admin/DataTable.jsx';
import {
  EntityFilter,
  FilterBar,
  SearchBox,
  SelectFilter,
} from '../../components/admin/Filters.jsx';
import { IncidentsTable } from '../../components/admin/Tables.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { useNow } from '../../hooks/useNow.js';

const DEFAULTS = { search: '', status: 'all', workspaceId: '', workspaceName: '' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All incidents' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];

export default function Incidents() {
  const [params, set] = useListParams(DEFAULTS);
  const now = useNow();
  const query = useAdminIncidents({
    search: params.search,
    status: params.status,
    workspaceId: params.workspaceId,
    page: params.page,
    limit: params.limit,
  });
  const { data } = query;

  return (
    <>
      <PageHeader title="Incidents." phrase="Every incident on the platform, newest first." />
      <Card>
        <FilterBar>
          <SearchBox
            label="Search incidents"
            placeholder="Monitor or cause"
            value={params.search}
            onSearch={(search) => set({ search })}
          />
          <SelectFilter
            label="Status"
            value={params.status}
            options={STATUS_OPTIONS}
            onChange={(status) => set({ status })}
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
        </FilterBar>
        <IncidentsTable
          caption="Incidents"
          rows={data?.data}
          now={now}
          isPending={query.isPending}
          isFetching={query.isFetching}
          isError={query.isError}
          errorText="Couldn't load incidents."
          empty={{ title: 'No incidents found', description: 'Try a different status or search.' }}
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
