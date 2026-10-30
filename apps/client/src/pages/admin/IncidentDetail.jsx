import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAdminIncident } from '../../api/admin.js';
import {
  ErrorLine,
  Fact,
  Facts,
  LoadingRows,
  TextLink,
  When,
} from '../../components/admin/AdminBits.jsx';
import IncidentTimeline from '../../components/incidents/IncidentTimeline.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import CodeChip from '../../components/ui/CodeChip.jsx';
import { useNow } from '../../hooks/useNow.js';
import { incidentTone } from '../../lib/adminConsole.js';
import { formatDuration } from '../../lib/format.js';
import NotFound from '../NotFound.jsx';

export default function IncidentDetail() {
  const { id } = useParams();
  const now = useNow();
  const { data, isPending, isError, error } = useAdminIncident(id);

  if (error?.response?.status === 404) return <NotFound message="This incident doesn't exist." />;
  if (isPending || isError) {
    return (
      <>
        <PageHeader title="Incident." />
        <Card>{isError ? <ErrorLine error={error} what="this incident" /> : <LoadingRows />}</Card>
      </>
    );
  }

  const tone = incidentTone(data);
  const duration = data.resolvedAt
    ? formatDuration(data.durationSec)
    : `${formatDuration((now - new Date(data.startedAt).getTime()) / 1000)} so far`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/app/admin/incidents"
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint transition-colors duration-200 hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All incidents
        </Link>
        <PageHeader title={data.monitorName} phrase={data.workspace.name} />
        <div className="-mt-4">
          <Badge tone={tone.tone}>{tone.label}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader title="Details" />
        <Facts className="p-5">
          <Fact label="Cause">
            {data.causeCode && <CodeChip className="mr-2">{data.causeCode}</CodeChip>}
            {data.cause}
          </Fact>
          <Fact label="Started">
            <When value={data.startedAt} now={now} />
          </Fact>
          <Fact label={data.resolvedAt ? 'Resolved' : 'Resolved at'}>
            <When value={data.resolvedAt} now={now} empty="Still open" />
          </Fact>
          <Fact label="Duration">{duration}</Fact>
          <Fact label="Monitor">
            <TextLink to={`/app/${data.workspace.id}/monitors/${data.monitorId}`}>
              Open the monitor page
            </TextLink>
          </Fact>
          <Fact label="Workspace">
            <TextLink to={`/app/admin/workspaces/${data.workspace.id}`}>
              {data.workspace.name}
            </TextLink>
          </Fact>
        </Facts>
      </Card>

      <Card>
        <CardHeader title="Timeline" description="What happened, oldest first." />
        <div className="p-5 pl-7">
          {data.timeline?.length ? (
            <IncidentTimeline events={data.timeline} />
          ) : (
            <p className="text-sm text-muted">No events were recorded.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
