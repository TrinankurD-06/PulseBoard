import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAppMeta } from '../../api/meta.js';
import { useCreateMonitor } from '../../api/monitors.js';
import HeartbeatForm from '../../components/monitors/HeartbeatForm.jsx';
import MonitorForm from '../../components/monitors/MonitorForm.jsx';
import TypeChooser from '../../components/monitors/TypeChooser.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import { HEARTBEAT_TYPE } from '../../lib/heartbeat.js';

const DESCRIPTIONS = {
  http: 'PulseBoard will check this URL on a schedule.',
  heartbeat: 'Your job pings PulseBoard; we alert you when a ping is late.',
};

export default function NewMonitor() {
  const { wid } = useCurrentWorkspace();
  const navigate = useNavigate();
  const { data: meta } = useAppMeta();
  const createMonitor = useCreateMonitor(wid);
  const [type, setType] = useState('http');

  async function onSubmit(payload) {
    try {
      const monitor = await createMonitor.mutateAsync(
        type === HEARTBEAT_TYPE ? { ...payload, type: HEARTBEAT_TYPE } : payload,
      );
      toast.success(`Monitor "${monitor.name}" created`);
      navigate(`/app/${wid}/monitors/${monitor.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  const cancel = () => navigate(`/app/${wid}`);

  return (
    <div className="max-w-3xl">
      <PageHeader title="New monitor" description={DESCRIPTIONS[type]} />
      <TypeChooser value={type} onChange={setType} />
      {!meta && <Skeleton className="h-96 rounded-xl" />}
      {meta && type === HEARTBEAT_TYPE && (
        <HeartbeatForm
          minIntervalSec={meta.minIntervalSec}
          submitLabel="Create heartbeat"
          onSubmit={onSubmit}
          onCancel={cancel}
        />
      )}
      {meta && type !== HEARTBEAT_TYPE && (
        <MonitorForm
          wid={wid}
          minIntervalSec={meta.minIntervalSec}
          submitLabel="Create monitor"
          onSubmit={onSubmit}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
