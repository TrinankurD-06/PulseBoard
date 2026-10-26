import { Activity } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';

export default function Dashboard() {
  const { workspace } = useCurrentWorkspace();
  return (
    <>
      <PageHeader title={workspace.name} description="Overview of all monitors in this workspace" />
      <EmptyState
        icon={Activity}
        title="No monitors yet"
        description="Monitors arrive in the next phase."
      />
    </>
  );
}
