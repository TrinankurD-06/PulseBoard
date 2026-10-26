import { Hammer } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

// Temporary page for sections built in later phases.
export default function ComingSoon({ title }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={Hammer}
        title="Coming soon"
        description="This section is under construction."
      />
    </>
  );
}
