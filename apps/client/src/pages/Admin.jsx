import { Pause, Play, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAdminUsers, useSetUserMonitors } from '../api/admin.js';
import { errorMessage } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import { useConfirm } from '../components/ui/confirmContext.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClasses } from '../components/ui/Field.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useNow } from '../hooks/useNow.js';
import {
  monitorToggle,
  resultMessage,
  stopConfirmation,
  userTags,
  workspaceLabel,
} from '../lib/admin.js';
import { cn } from '../lib/cn.js';
import { timeAgo } from '../lib/format.js';
import NotFound from './NotFound.jsx';

const PAGE_SIZE = 25;

function Counts({ monitors }) {
  const parts = [
    [monitors.total, 'total'],
    [monitors.running, 'running'],
    [monitors.stoppedByAdmin, 'stopped by you'],
    [monitors.paused, 'paused by user'],
  ].filter(([count], index) => index === 0 || count > 0);
  return (
    <p className="text-xs text-muted tabular-nums">
      {parts.map(([count, label]) => `${count} ${label}`).join(' · ')}
      {monitors.down > 0 && <span className="text-status-down"> · {monitors.down} down</span>}
    </p>
  );
}

function UserRow({ row, now }) {
  const setMonitors = useSetUserMonitors();
  const confirm = useConfirm();
  const toggle = monitorToggle(row.monitors);

  async function onClick() {
    if (toggle.action === 'stop') {
      const confirmed = await confirm({
        title: `Stop monitors for ${row.name}`,
        message: stopConfirmation(row),
        confirmLabel: 'Stop monitors',
      });
      if (!confirmed) return;
    }
    try {
      const result = await setMonitors.mutateAsync({ userId: row.id, action: toggle.action });
      const message = resultMessage(toggle.action, result);
      if (result.failed.length) toast.warning(message);
      else toast.success(message);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const Icon = toggle.action === 'start' ? Play : Pause;
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-[2_1_16rem]">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg">
          <span className="truncate">{row.name}</span>
          {userTags(row).map((tag) => (
            <Badge key={tag} tone={tag === 'Demo' ? 'amber' : 'neutral'}>
              {tag}
            </Badge>
          ))}
        </p>
        <p className="truncate text-xs text-faint">{row.email}</p>
        <p className="mt-1 text-xs text-faint">
          Joined {timeAgo(row.createdAt, now)} ·{' '}
          {row.lastSeenAt ? `last sign-in ${timeAgo(row.lastSeenAt, now)}` : 'never signed in'}
        </p>
      </div>

      <div className="min-w-0 flex-[2_1_14rem]">
        <ul className="space-y-0.5">
          {row.workspaces.map((workspace) => (
            <li
              key={workspace.id}
              className={cn('truncate text-xs', workspace.managed ? 'text-muted' : 'text-faint')}
            >
              {workspaceLabel(workspace)}
            </li>
          ))}
        </ul>
        <div className="mt-1">
          <Counts monitors={row.monitors} />
        </div>
      </div>

      <div className="flex-none">
        <Button
          variant={
            toggle.action === 'stop'
              ? 'danger'
              : toggle.action === 'start'
                ? 'primary'
                : 'secondary'
          }
          size="sm"
          disabled={!toggle.action}
          loading={setMonitors.isPending}
          onClick={onClick}
          title={toggle.hint}
          aria-label={`${toggle.label} for ${row.name}`}
        >
          {toggle.action && !setMonitors.isPending && (
            <Icon className="h-4 w-4" aria-hidden="true" />
          )}
          {toggle.label}
        </Button>
      </div>
    </li>
  );
}

/** The administrator's view: every user, and one button to stop or start a user's monitors. */
export default function Admin() {
  const { isAdmin } = useAuth();
  const now = useNow();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [input]);

  const { data, isPending, isError, isFetching } = useAdminUsers({
    search,
    page,
    limit: PAGE_SIZE,
  });

  if (!isAdmin) return <NotFound message="This page doesn't exist." />;

  const total = data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Admin."
        phrase="Every user, and one switch for their monitors. Stopped monitors stay stopped until you start them."
      />

      <Card>
        <CardHeader
          title="Users"
          description={data ? `${total} ${total === 1 ? 'user' : 'users'}` : undefined}
          action={
            <label className="relative block">
              <span className="sr-only">Search users</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <input
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Search name or email"
                className={cn(inputClasses, 'w-64 max-w-full py-1.5 pl-9')}
              />
            </label>
          }
        />
        {isPending && (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        )}
        {isError && <p className="p-5 text-sm text-status-down">Couldn&apos;t load users.</p>}
        {data && data.data.length === 0 && (
          <EmptyState title="No users found" description="Try a different name or email." />
        )}
        {data && data.data.length > 0 && (
          <ul className={cn('divide-y divide-line transition-opacity', isFetching && 'opacity-60')}>
            {data.data.map((row) => (
              <UserRow key={row.id} row={row} now={now} />
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
            <span>
              Page {page} of {pages}
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </span>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-medium text-fg">What the button does</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            It acts on the workspaces a user <strong className="font-medium text-fg">owns</strong>{' '}
            (for the demo user, its demo workspace), never on one they were only invited to.
          </li>
          <li>
            <strong className="font-medium text-fg">Stop</strong> pauses every running monitor and
            cancels its checks. The user cannot resume it; only you can.
          </li>
          <li>
            <strong className="font-medium text-fg">Start</strong> resumes only the monitors you
            stopped. Ones the user paused themselves stay paused.
          </li>
        </ul>
      </Card>
    </div>
  );
}
