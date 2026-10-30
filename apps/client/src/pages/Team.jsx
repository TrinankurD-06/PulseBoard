import { zodResolver } from '@hookform/resolvers/zod';
import { ROLES } from '@pulseboard/shared/constants';
import { addMemberSchema } from '@pulseboard/shared/schemas';
import { Trash2, UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { errorMessage } from '../api/http.js';
import {
  useAddMember,
  useChangeMemberRole,
  useMembers,
  useRemoveMember,
} from '../api/workspaces.js';
import { useAuth } from '../auth/AuthContext.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import { useConfirm } from '../components/ui/confirmContext.js';
import Field, { inputClasses } from '../components/ui/Field.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import { cn } from '../lib/cn.js';

const ROLE_DESCRIPTIONS = {
  owner: 'Everything, including members and workspace settings',
  member: 'Manage monitors, alert channels and status pages',
  viewer: 'Read-only access',
};

const ROLE_TONE = { owner: 'green', member: 'blue', viewer: 'neutral' };

function AddMemberForm({ wid }) {
  const addMember = useAddMember(wid);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: '', role: ROLES.MEMBER },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await addMember.mutateAsync(values);
      toast.success(`${values.email} added as ${values.role}`);
      reset();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Card>
      <CardHeader
        title="Add a team member"
        description="They need a PulseBoard account. Add them by the email they signed up with."
      />
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start"
      >
        <Field
          className="flex-1"
          aria-label="Email"
          type="email"
          placeholder="teammate@company.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Field as="select" aria-label="Role" className="sm:w-36" {...register('role')}>
          <option value={ROLES.VIEWER}>Viewer</option>
          <option value={ROLES.MEMBER}>Member</option>
          <option value={ROLES.OWNER}>Owner</option>
        </Field>
        <Button type="submit" loading={addMember.isPending}>
          <UserPlus className="h-4 w-4" /> Add
        </Button>
      </form>
    </Card>
  );
}

function MemberRow({ member, wid, isOwner, isSelf }) {
  const changeRole = useChangeMemberRole(wid);
  const removeMember = useRemoveMember(wid);
  const confirm = useConfirm();

  async function onRoleChange(event) {
    const role = event.target.value;
    try {
      await changeRole.mutateAsync({ userId: member.userId, role });
      toast.success(`${member.name} is now ${role === 'owner' ? 'an' : 'a'} ${role}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onRemove() {
    const confirmed = await confirm({
      title: 'Remove member',
      message: `Remove ${member.name} from this workspace? They lose access immediately.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    try {
      await removeMember.mutateAsync(member.userId);
      toast.success(`${member.name} removed`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-line text-sm text-muted uppercase">
        {member.name.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">
          {member.name} {isSelf && <span className="text-faint">(you)</span>}
        </p>
        <p className="truncate text-xs text-faint">{member.email}</p>
      </div>
      {isOwner ? (
        <div className="flex items-center gap-2">
          <select
            aria-label={`Role for ${member.name}`}
            value={member.role}
            onChange={onRoleChange}
            disabled={changeRole.isPending}
            className={cn(inputClasses, 'w-32 py-1.5 [&>option]:bg-bg [&>option]:text-fg')}
          >
            <option value={ROLES.VIEWER}>Viewer</option>
            <option value={ROLES.MEMBER}>Member</option>
            <option value={ROLES.OWNER}>Owner</option>
          </select>
          <Button
            variant="danger"
            size="sm"
            onClick={onRemove}
            loading={removeMember.isPending}
            aria-label={`Remove ${member.name}`}
          >
            {!removeMember.isPending && <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <Badge tone={ROLE_TONE[member.role]} className="capitalize">
          {member.role}
        </Badge>
      )}
    </li>
  );
}

export default function Team() {
  const { wid, can } = useCurrentWorkspace();
  const { user } = useAuth();
  const { data: members, isPending, isError } = useMembers(wid);
  const isOwner = can(ROLES.OWNER);

  return (
    <div className="space-y-8">
      <PageHeader title="Team." phrase="People with access to this workspace." />

      {isOwner && <AddMemberForm wid={wid} />}

      <Card>
        <CardHeader
          title="Members"
          description={members ? `${members.length} people` : undefined}
        />
        {isPending && (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}
        {isError && <p className="p-5 text-sm text-status-down">Couldn&apos;t load members.</p>}
        {members && (
          <ul className="divide-y divide-line">
            {members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                wid={wid}
                isOwner={isOwner}
                isSelf={member.userId === user?.id}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-medium text-fg">Roles</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <div key={role}>
              <dt>
                <Badge tone={ROLE_TONE[role]} className="capitalize">
                  {role}
                </Badge>
              </dt>
              <dd className="mt-1 text-muted">{description}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
