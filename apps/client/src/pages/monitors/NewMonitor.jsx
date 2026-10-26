import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAppMeta } from '../../api/meta.js';
import { useCreateMonitor } from '../../api/monitors.js';
import MonitorForm from '../../components/monitors/MonitorForm.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';

export default function NewMonitor() {
  const { wid } = useCurrentWorkspace();
  const navigate = useNavigate();
  const { data: meta } = useAppMeta();
  const createMonitor = useCreateMonitor(wid);

  async function onSubmit(payload) {
    try {
      const monitor = await createMonitor.mutateAsync(payload);
      toast.success(`Monitor "${monitor.name}" created`);
      navigate(`/app/${wid}/monitors/${monitor.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New monitor" description="PulseBoard will check this URL on a schedule." />
      {meta ? (
        <MonitorForm
          wid={wid}
          minIntervalSec={meta.minIntervalSec}
          submitLabel="Create monitor"
          onSubmit={onSubmit}
          onCancel={() => navigate(`/app/${wid}`)}
        />
      ) : (
        <Skeleton className="h-96 rounded-xl" />
      )}
    </div>
  );
}
