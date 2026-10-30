import { formatUptime } from '@pulseboard/shared/uptime';
import { ArrowLeft, LogOut, Pause, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useAdminUser,
  useDeleteUser,
  useRevokeSessions,
  useSuspendUser,
  useUnsuspendUser,
} from '../../api/admin.js';
import { errorMessage } from '../../api/http.js';
import {
  ErrorLine,
  Fact,
  Facts,
  LoadingRows,
  TextLink,
  When,
} from '../../components/admin/AdminBits.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import { EntityPicker } from '../../components/admin/Filters.jsx';
import ReasonDialog from '../../components/admin/ReasonDialog.jsx';
import { IncidentsTable, MonitorSummaryTable } from '../../components/admin/Tables.jsx';
import TypedConfirmDialog from '../../components/admin/TypedConfirmDialog.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import { useConfirm } from '../../components/ui/confirmContext.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useNow } from '../../hooks/useNow.js';
import {
  accountStatus,
  monthlyCostText,
  platformRoleLabel,
  protectedReason,
  providersText,
  shortDate,
} from '../../lib/adminConsole.js';
import { formatCount, formatMonth } from '../../lib/format.js';
import NotFound from '../NotFound.jsx';

const plural = (n, one, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

function ModeOption({ value, current, onChange, title, children }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line p-3 transition-colors has-[:checked]:border-line-strong has-[:checked]:bg-surface-2">
      <input
        type="radio"
        name="delete-mode"
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="mt-1 accent-(--accent)"
      />
      <span className="min-w-0 text-sm">
        <span className="block text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{children}</span>
      </span>
    </label>
  );
}

function DeleteUserDialog({ user, owned, open, onCancel, onDone }) {
  const remove = useDeleteUser();
  const [mode, setMode] = useState('cascade');
  const [target, setTarget] = useState(null);

  return (
    <TypedConfirmDialog
      open={open}
      title="Delete this user"
      requiredText={user.email}
      inputLabel="Type the user's email to confirm"
      confirmLabel="Delete user"
      extraReady={mode === 'cascade' || Boolean(target)}
      onCancel={onCancel}
      onConfirm={async () => {
        const result = await remove.mutateAsync({
          id: user.id,
          confirm: user.email,
          mode,
          reassignTo: target?.id,
        });
        onDone(result);
      }}
      consequences={
        <>
          <p>
            This permanently deletes <strong className="font-medium text-fg">{user.name}</strong> (
            {user.email}) and signs them out everywhere. It cannot be undone.
          </p>
          <p>
            {owned.length === 0
              ? 'They own no workspaces.'
              : `They own ${plural(owned.length, 'workspace')}: ${owned.map((w) => w.name).join(', ')}. Choose what happens to them.`}
          </p>
        </>
      }
    >
      {owned.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs text-faint">Their workspaces</legend>
          <ModeOption
            value="cascade"
            current={mode}
            onChange={setMode}
            title="Delete their workspaces"
          >
            The workspaces, their monitors, incidents and history are deleted with the user.
          </ModeOption>
          <ModeOption
            value="reassign"
            current={mode}
            onChange={setMode}
            title="Reassign to another user"
          >
            The other user becomes the owner. Nothing is lost.
          </ModeOption>
          {mode === 'reassign' && (
            <div className="pt-2">
              {target ? (
                <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg">
                  <span className="min-w-0 wrap-anywhere">
                    {target.name} <span className="text-faint">· {target.email}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                    Change
                  </Button>
                </p>
              ) : (
                <EntityPicker
                  kind="users"
                  label="New owner"
                  placeholder="Search name or email"
                  excludeId={user.id}
                  onPick={setTarget}
                />
              )}
            </div>
          )}
        </fieldset>
      )}
    </TypedConfirmDialog>
  );
}

function Actions({ user, owned }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const suspend = useSuspendUser();
  const unsuspend = useUnsuspendUser();
  const revoke = useRevokeSessions();
  const [dialog, setDialog] = useState(null);
  const status = accountStatus(user);
  const blocked = protectedReason(user, me);
  const close = () => setDialog(null);

  async function onUnsuspend() {
    const ok = await confirm({
      title: `Unsuspend ${user.name}`,
      message:
        'They can sign in again. Monitors paused by the suspension stay paused: resume them from the monitor list.',
      confirmLabel: 'Unsuspend',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      await unsuspend.mutateAsync({ id: user.id });
      toast.success('User unsuspended');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onRevoke() {
    const ok = await confirm({
      title: `Revoke sessions for ${user.name}`,
      message: 'Every device they are signed in on is signed out. They can sign in again.',
      confirmLabel: 'Revoke sessions',
    });
    if (!ok) return;
    try {
      const result = await revoke.mutateAsync({ id: user.id });
      toast.success(`Revoked ${plural(result.revoked ?? 0, 'session')}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader title="Actions" description="Each action is recorded in the audit log." />
      <div className="flex flex-wrap items-center gap-3 p-5">
        {status.suspended ? (
          <Button
            variant="primary"
            size="sm"
            disabled={Boolean(blocked)}
            loading={unsuspend.isPending}
            onClick={onUnsuspend}
          >
            <Play className="h-4 w-4" aria-hidden="true" /> Unsuspend
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={Boolean(blocked)}
            onClick={() => setDialog('suspend')}
          >
            <Pause className="h-4 w-4" aria-hidden="true" /> Suspend
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(blocked)}
          loading={revoke.isPending}
          onClick={onRevoke}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> Revoke sessions
          {typeof user.sessionsActive === 'number' && (
            <span className="text-faint">({user.sessionsActive})</span>
          )}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={Boolean(blocked)}
          onClick={() => setDialog('delete')}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete user
        </Button>
        {blocked && (
          <p className="basis-full text-sm text-muted" id="user-actions-blocked">
            Suspend, Revoke sessions and Delete are unavailable: {blocked}
          </p>
        )}
      </div>

      <ReasonDialog
        open={dialog === 'suspend'}
        title={`Suspend ${user.name}`}
        description={
          <>
            <p>They cannot sign in, and their monitors are paused.</p>
            <p>The reason is recorded in the audit log and shown to nobody else.</p>
          </>
        }
        label="Reason"
        submitLabel="Suspend user"
        onCancel={close}
        onSubmit={async (reason) => {
          const result = await suspend.mutateAsync({ id: user.id, reason });
          toast.success(`User suspended; ${plural(result.pausedMonitors ?? 0, 'monitor')} paused`);
          close();
        }}
      />
      <DeleteUserDialog
        key={`${user.id}-${dialog === 'delete'}`}
        user={user}
        owned={owned}
        open={dialog === 'delete'}
        onCancel={close}
        onDone={(result) => {
          close();
          toast.success(
            `User deleted; ${plural(result.deletedWorkspaces ?? 0, 'workspace')} deleted, ${formatCount(result.reassignedWorkspaces ?? 0)} reassigned`,
          );
          navigate('/app/admin/users', { replace: true });
        }}
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

export default function UserDetail() {
  const { id } = useParams();
  const now = useNow();
  const { data, isPending, isError, error } = useAdminUser(id);

  if (error?.response?.status === 404) return <NotFound message="This user doesn't exist." />;
  if (isPending || isError) {
    return (
      <>
        <PageHeader title="User." />
        <Card>{isError ? <ErrorLine error={error} what="this user" /> : <LoadingRows />}</Card>
      </>
    );
  }

  const { profile, workspaces, monitors, incidents, alertChannels, usage, analytics } = data;
  const status = accountStatus(profile);
  const owned = workspaces.filter((workspace) => workspace.role === 'owner');

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/app/admin/users"
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint transition-colors duration-200 hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All users
        </Link>
        <PageHeader title={profile.name || profile.email} phrase={profile.email} />
        <div className="-mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge>{platformRoleLabel(profile.platformRole)}</Badge>
          {profile.isDemo && <Badge tone="amber">Demo</Badge>}
        </div>
        {status.suspended && (
          <p
            role="status"
            className="mt-5 max-w-[70ch] rounded-card border border-status-down/60 px-4 py-3 text-sm text-fg"
          >
            Suspended on {shortDate(profile.suspendedAt)}
            {profile.suspendedReason ? `: ${profile.suspendedReason}` : '.'}
          </p>
        )}
      </div>

      <Actions user={profile} owned={owned} />

      <Section title="Profile">
        <Facts className="p-5">
          <Fact label="Name">{profile.name}</Fact>
          <Fact label="Email">{profile.email}</Fact>
          <Fact label="Sign-in">{providersText(profile.providers)}</Fact>
          <Fact label="Created">{shortDate(profile.createdAt)}</Fact>
          <Fact label="Last login">
            <When value={profile.lastLoginAt} now={now} />
          </Fact>
          <Fact label="Active sessions">{formatCount(profile.sessionsActive)}</Fact>
        </Facts>
      </Section>

      <Section title="Workspaces" description="Where they work, and their role in each.">
        <DataTable
          caption="Workspaces"
          rows={workspaces}
          empty={{ title: 'No workspaces', description: 'This user belongs to none.' }}
          columns={[
            {
              key: 'name',
              header: 'Workspace',
              primary: true,
              cell: (row) => (
                <TextLink to={`/app/admin/workspaces/${row.id}`} className="font-medium">
                  {row.name}
                </TextLink>
              ),
            },
            { key: 'role', header: 'Role', className: 'capitalize', cell: (row) => row.role },
            {
              key: 'status',
              header: 'Status',
              cell: (row) => {
                const s = accountStatus(row);
                return <Badge tone={s.tone}>{s.label}</Badge>;
              },
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

      <Section
        title="Monitors"
        description={`${plural(monitors.length, 'monitor')} across their workspaces.`}
      >
        <MonitorSummaryTable rows={monitors} now={now} caption="Monitors" />
      </Section>

      <Section title="Incidents" description="The newest 50.">
        <IncidentsTable rows={incidents} now={now} caption="Incidents" />
      </Section>

      <Section
        title="Alert channels"
        description="Targets are masked: only the last characters show."
      >
        <DataTable
          caption="Alert channels"
          rows={alertChannels}
          empty={{ title: 'No alert channels', description: 'They have not set any up.' }}
          columns={[
            {
              key: 'name',
              header: 'Channel',
              primary: true,
              cell: (row) => <span className="text-fg">{row.name}</span>,
            },
            { key: 'type', header: 'Type', className: 'capitalize', cell: (row) => row.type },
            {
              key: 'target',
              header: 'Target',
              cell: (row) => <span className="font-mono text-xs">{row.targetMasked}</span>,
            },
            {
              key: 'workspace',
              header: 'Workspace',
              cell: (row) => (
                <TextLink to={`/app/admin/workspaces/${row.workspaceId}`} className="text-muted">
                  {row.workspaceName}
                </TextLink>
              ),
            },
            {
              key: 'enabled',
              header: 'State',
              cell: (row) => (
                <Badge tone={row.isEnabled ? 'green' : 'neutral'}>
                  {row.isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              ),
            },
          ]}
        />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Usage and cost"
          description={usage?.month ? formatMonth(usage.month) : 'This month'}
        >
          <Facts cols={2} className="p-5">
            <Fact label="Requests">{formatCount(usage?.requests)}</Fact>
            <Fact label="Heartbeat pings">{formatCount(usage?.pings)}</Fact>
            <Fact label="Agent reports">{formatCount(usage?.reports)}</Fact>
            <Fact label="Monthly cost">{monthlyCostText(usage?.monthlyCost)}</Fact>
          </Facts>
        </Section>
        <Section title="Analytics" description="The last 30 days.">
          <Facts cols={2} className="p-5">
            <Fact label="Uptime">
              {analytics?.uptime30d == null ? '—' : `${formatUptime(analytics.uptime30d)}%`}
            </Fact>
            <Fact label="Checks run">{formatCount(analytics?.checks30d)}</Fact>
            <Fact label="Alerts sent">{formatCount(analytics?.alertsSent30d)}</Fact>
          </Facts>
        </Section>
      </div>
    </div>
  );
}
