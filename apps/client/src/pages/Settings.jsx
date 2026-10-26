import { zodResolver } from '@hookform/resolvers/zod';
import { ROLES } from '@pulseboard/shared/constants';
import { updateWorkspaceSchema } from '@pulseboard/shared/schemas';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../api/http.js';
import { useDeleteWorkspace, useRenameWorkspace } from '../api/workspaces.js';
import PageHeader from '../components/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Field from '../components/ui/Field.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';

function RenameForm({ workspace, disabled }) {
  const rename = useRenameWorkspace(workspace.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(updateWorkspaceSchema),
    values: { name: workspace.name },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await rename.mutateAsync(values);
      toast.success('Workspace renamed');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Card>
      <CardHeader title="General" />
      <form onSubmit={onSubmit} noValidate className="space-y-4 p-5">
        <Field
          label="Workspace name"
          disabled={disabled}
          error={errors.name?.message}
          {...register('name')}
        />
        {!disabled && (
          <Button type="submit" disabled={!isDirty} loading={rename.isPending}>
            Save
          </Button>
        )}
      </form>
    </Card>
  );
}

function DangerZone({ workspace }) {
  const navigate = useNavigate();
  const deleteWorkspace = useDeleteWorkspace(workspace.id);
  const [confirmation, setConfirmation] = useState('');

  async function onDelete() {
    try {
      await deleteWorkspace.mutateAsync();
      toast.success(`Workspace "${workspace.name}" deleted`);
      navigate('/app', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card className="border-red-300 dark:border-red-900/60">
      <CardHeader
        title="Delete workspace"
        description="Permanently deletes all monitors, check history, incidents, alert channels and status pages. This can't be undone."
      />
      <div className="space-y-3 p-5">
        <Field
          label={`Type "${workspace.name}" to confirm`}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <Button
          variant="danger"
          disabled={confirmation !== workspace.name}
          loading={deleteWorkspace.isPending}
          onClick={onDelete}
        >
          Delete this workspace
        </Button>
      </div>
    </Card>
  );
}

export default function Settings() {
  const { workspace, can } = useCurrentWorkspace();
  const isOwner = can(ROLES.OWNER);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        description={isOwner ? undefined : 'Only workspace owners can change these settings.'}
      />
      <RenameForm workspace={workspace} disabled={!isOwner} />
      {isOwner && <DangerZone workspace={workspace} />}
    </div>
  );
}
