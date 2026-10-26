import { zodResolver } from '@hookform/resolvers/zod';
import { createWorkspaceSchema } from '@pulseboard/shared/schemas';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useCreateWorkspace } from '../../api/workspaces.js';
import Button from '../ui/Button.jsx';
import Field from '../ui/Field.jsx';
import Modal from '../ui/Modal.jsx';

export default function CreateWorkspaceModal({ open, onClose }) {
  const navigate = useNavigate();
  const createWorkspace = useCreateWorkspace();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(createWorkspaceSchema), defaultValues: { name: '' } });

  function close() {
    reset();
    onClose();
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const workspace = await createWorkspace.mutateAsync(values);
      toast.success(`Workspace "${workspace.name}" created`);
      close();
      navigate(`/app/${workspace.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Modal open={open} onClose={close} title="Create a workspace">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Workspace name"
          placeholder="Acme Inc."
          autoFocus
          error={errors.name?.message}
          {...register('name')}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={createWorkspace.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
