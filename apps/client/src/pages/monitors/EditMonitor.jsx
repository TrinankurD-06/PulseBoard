import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAppMeta } from '../../api/meta.js';
import { useMonitor, useUpdateMonitor } from '../../api/monitors.js';
import MonitorForm from '../../components/monitors/MonitorForm.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';

export default function EditMonitor() {
  const { wid } = useCurrentWorkspace();
  const { mid } = useParams();
  const navigate = useNavigate();
  const { data: meta } = useAppMeta();
  const { data: monitor, isError } = useMonitor(wid, mid);
  const updateMonitor = useUpdateMonitor(wid, mid);
  const detailPath = `/app/${wid}/monitors/${mid}`;

  async function onSubmit(payload) {
    try {
      await updateMonitor.mutateAsync(payload);
      toast.success('Monitor updated');
      navigate(detailPath);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  if (isError) return <p className="text-sm text-red-600">Couldn&apos;t load this monitor.</p>;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Edit monitor" description={monitor?.name} />
      {meta && monitor ? (
        <MonitorForm
          wid={wid}
          monitor={monitor}
          minIntervalSec={meta.minIntervalSec}
          submitLabel="Save changes"
          onSubmit={onSubmit}
          onCancel={() => navigate(detailPath)}
        />
      ) : (
        <Skeleton className="h-96 rounded-xl" />
      )}
    </div>
  );
}
