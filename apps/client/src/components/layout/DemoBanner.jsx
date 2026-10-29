import { useAppMeta } from '../../api/meta.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isDemoReadOnly } from '../../lib/demo.js';

/** A calm one-line notice for the public demo account (the server blocks its writes). */
export default function DemoBanner() {
  const { user } = useAuth();
  const { data: meta } = useAppMeta();
  if (!isDemoReadOnly(meta, user)) return null;
  return (
    <p
      role="status"
      title="You can look around; changes are disabled"
      className="rounded-card border border-line bg-surface/60 px-3 py-1.5 text-center text-xs text-muted"
    >
      Demo mode — read-only
      <span className="sr-only">. You can look around; changes are disabled.</span>
    </p>
  );
}
