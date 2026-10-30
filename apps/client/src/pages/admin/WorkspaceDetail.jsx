import { ArrowLeft, ArrowRightLeft, Eye, Pause, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useAdminWorkspace,
  useDeleteWorkspace,
  useSuspendWorkspace,
  useTransferWorkspace,
  useUnsuspendWorkspace,
} from '../../api/admin.js';
import { errorMessage } from '../../api/http.js';
import {
  ErrorLine,
  Fact,
  Facts,
  LoadingRows,
  TextLink,
} from '../../components/admin/AdminBits.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import ReasonDialog from '../../components/admin/ReasonDialog.jsx';
import { IncidentsTable, MonitorSummaryTable } from '../../components/admin/Tables.jsx';
import TypedConfirmDialog from '../../components/admin/TypedConfirmDialog.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import { useConfirm } from '../../components/ui/confirmContext.js';
import Field from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useNow } from '../../hooks/useNow.js';
import { accountStatus, monthlyCostText, shortDate } from '../../lib/adminConsole.js';
import { formatCount, formatMonth } from '../../lib/format.js';
import NotFound from '../NotFound.jsx';

function TransferForm({ workspace, members, onCancel, onDone }) {
  const transfer = useTransferWorkspace();
  const candidates = members.filter((member) => member.role !== 'owner');
  const [newOwnerId, setNewOwnerId] = useState(candidates[0]?.userId ?? '');
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      await transfer.mutateAsync({ id: workspace.id, newOwnerId });
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  if (candidates.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted">
          This workspace has no other members to hand ownership to. Ownership can only go to a
          member.
        </p>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="text-sm text-muted">
        The member you pick becomes the owner. The current owner stays on as a member.
      </p>
      <Field
        as="select"
        label="New owner"
        value={newOwnerId}
        onChange={(event) => setNewOwnerId(event.target.value)}
        className="mt-5"
      >
        {candidates.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name} ({member.email}) · {member.role}
          </option>
        ))}
      </Field>
      {error && (
        <p role="alert" className="mt-4 text-sm text-status-down">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={transfer.isPending} disabled={!newOwnerId}>
          Transfer ownership
        </Button>
      </div>
    </form>
  );
}

function Actions({ workspace, members }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const suspend = useSuspendWorkspace();
  const unsuspend = useUnsuspendWorkspace();
  const remove = useDeleteWorkspace();
  const [dialog, setDialog] = useState(null);
  const suspended = Boolean(workspace.suspendedAt);
  const close = () => setDialog(null);

  async function onUnsuspend() {
    const ok = await confirm({
      title: `Unsuspend ${workspace.name}`,
      message:
        'Members can use the workspace again. Monitors paused by the suspension stay paused: resume them from the monitor list.',
      confirmLabel: 'Unsuspend',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      await unsuspend.mutateAsync({ id: workspace.id });
      toast.success('Workspace unsuspended');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader title="Actions" description="Each action is recorded in the audit log." />
      <div className="flex flex-wrap items-center gap-3 p-5">
        <Link
          to={`/app/${workspace.id}`}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-pill border border-line-strong px-3.5 text-[13px] font-medium whitespace-nowrap text-fg transition-colors duration-200 ease-(--ease) hover:border-fg hover:bg-surface-2"
        >
          <Eye className="h-4 w-4" aria-hidden="true" /> Open read-only
        </Link>
        <Button variant="secondary" size="sm" onClick={() => setDialog('transfer')}>
          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Transfer ownership
        </Button>
        {suspended ? (
          <Button variant="primary" size="sm" loading={unsuspend.isPending} onClick={onUnsuspend}>
            <Play className="h-4 w-4" aria-hidden="true" /> Unsuspend
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setDialog('suspend')}>
            <Pause className="h-4 w-4" aria-hidden="true" /> Suspend
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={() => setDialog('delete')}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete workspace
        </Button>
      </div>

      <Modal open={dialog === 'transfer'} onClose={close} title="Transfer ownership">
        <TransferForm
          workspace={workspace}
          members={members}
          onCancel={close}
          onDone={() => {
            close();
            toast.success('Ownership transferred');
          }}
        />
      </Modal>

      <ReasonDialog
        open={dialog === 'suspend'}
        title={`Suspend ${workspace.name}`}
        description={
          <>
            <p>Members get an error explaining it is suspended, and its monitors are paused.</p>
            <p>The reason is shown to the members.</p>
          </>
        }
        label="Reason"
        submitLabel="Suspend workspace"
        onCancel={close}
        onSubmit={async (reason) => {
          await suspend.mutateAsync({ id: workspace.id, reason });
          toast.success('Workspace suspended');
          close();
        }}
      />

      <TypedConfirmDialog
        open={dialog === 'delete'}
        title="Delete this workspace"
        requiredText={workspace.name}
        inputLabel="Type the workspace name to confirm"
        confirmLabel="Delete workspace"
        onCancel={close}
        onConfirm={async () => {
          await remove.mutateAsync({ id: workspace.id, confirm: workspace.name });
          close();
          toast.success('Workspace deleted');
          navigate('/app/admin/workspaces', { replace: true });
        }}
        consequences={
          <p>
            This permanently deletes{' '}
            <strong className="font-medium text-fg">{workspace.name}</strong> with its monitors,
            check history, incidents, alert channels and status pages. It cannot be undone.
          </p>
        }
      />
    </Card>
  );
}

function Section({ title, description, children }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

export default function WorkspaceDetail() {
  const { id } = useParams();
  const now = useNow();
  const { data, isPending, isError, error } = useAdminWorkspace(id);

  if (error?.response?.status === 404) return <NotFound message="This workspace doesn't exist." />;
  if (isPending || isError) {
    return (
      <>
        <PageHeader title="Workspace." />
        <Card>{isError ? <ErrorLine error={error} what="this workspace" /> : <LoadingRows />}</Card>
      </>
    );
  }

  const { workspace, members, monitors, statusPages, incidents, usage } = data;
  const status = accountStatus(workspace);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/app/admin/workspaces"
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint transition-colors duration-200 hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All workspaces
        </Link>
        <PageHeader
          title={workspace.name}
          phrase={`/${workspace.slug} · created ${shortDate(workspace.createdAt)}`}
        />
        <div className="-mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        {status.suspended && (
          <p
            role="status"
            className="mt-5 max-w-[70ch] rounded-card border border-status-down/60 px-4 py-3 text-sm text-fg"
          >
            Suspended on {shortDate(workspace.suspendedAt)}
            {workspace.suspendedReason ? `: ${workspace.suspendedReason}` : '.'}
          </p>
        )}
      </div>

      <Actions workspace={workspace} members={members} />

      <Section title="Members" description="Who can work in this workspace.">
        <DataTable
          caption="Members"
          rows={members.map((member) => ({ ...member, id: member.userId }))}
          empty={{ title: 'No members', description: 'This workspace has no members.' }}
          columns={[
            {
              key: 'name',
              header: 'Member',
              primary: true,
              cell: (row) => (
                <div className="min-w-0">
                  <TextLink
                    to={`/app/admin/users/${row.userId}`}
                    className="font-medium wrap-anywhere"
                  >
                    {row.name || row.email}
                  </TextLink>
                  <p className="text-xs wrap-anywhere text-faint">{row.email}</p>
                </div>
              ),
            },
            { key: 'role', header: 'Role', className: 'capitalize', cell: (row) => row.role },
          ]}
        />
      </Section>

      <Section title="Monitors" description={`${formatCount(monitors.length)} in this workspace.`}>
        <MonitorSummaryTable rows={monitors} now={now} caption="Monitors" />
      </Section>

      <Section title="Status pages">
        <DataTable
          caption="Status pages"
          rows={statusPages}
          empty={{ title: 'No status pages', description: 'None have been created.' }}
          columns={[
            {
              key: 'title',
              header: 'Page',
              primary: true,
              cell: (row) =>
                row.isPublic ? (
                  <a
                    href={`/status/${row.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:text-brand"
                  >
                    {row.title}
                    <span className="sr-only"> (opens the public page in a new tab)</span>
                  </a>
                ) : (
                  <span className="font-medium text-fg">{row.title}</span>
                ),
            },
            {
              key: 'slug',
              header: 'Address',
              cell: (row) => <span className="font-mono text-xs">/status/{row.slug}</span>,
            },
            {
              key: 'public',
              header: 'Visibility',
              cell: (row) => (
                <Badge tone={row.isPublic ? 'green' : 'neutral'}>
                  {row.isPublic ? 'Public' : 'Private'}
                </Badge>
              ),
            },
            {
              key: 'monitors',
              header: 'Monitors',
              className: 'tabular-nums',
              cell: (row) => row.monitorsCount,
            },
          ]}
        />
      </Section>

      <Section title="Incidents" description="The newest 50.">
        <IncidentsTable rows={incidents} now={now} caption="Incidents" />
      </Section>

      <Section title="Usage" description={usage?.month ? formatMonth(usage.month) : 'This month'}>
        <Facts cols={4} className="p-5">
          <Fact label="Requests">{formatCount(usage?.requests)}</Fact>
          <Fact label="Heartbeat pings">{formatCount(usage?.pings)}</Fact>
          <Fact label="Agent reports">{formatCount(usage?.reports)}</Fact>
          <Fact label="Monthly cost">{monthlyCostText(usage?.monthlyCost)}</Fact>
        </Facts>
      </Section>
    </div>
  );
}
