import { Eye, PauseCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isWorkspaceSuspended, suspendedBannerText } from '../../lib/adminConsole.js';

/**
 * Shown to an administrator who opens a workspace they are not a member of: everything is
 * read-only (the API treats them as a viewer). Mirrors DemoBanner's calm one-line style.
 */
export function AdminViewBanner() {
  return (
    <p
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-card border border-status-degraded/60 bg-surface/60 px-3 py-1.5 text-center text-xs text-fg"
    >
      <span className="inline-flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5 shrink-0 text-status-degraded" aria-hidden="true" />
        Viewing as an administrator, read-only
      </span>
      <Link
        to="/app/admin"
        className="text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg"
      >
        Back to the admin console
      </Link>
    </p>
  );
}

/** Shown to members of a workspace an administrator suspended; the text includes the reason. */
export function SuspendedBanner({ workspace }) {
  if (!isWorkspaceSuspended(workspace)) return null;
  return (
    <p
      role="status"
      className="flex items-start justify-center gap-2 rounded-card border border-status-down/60 bg-surface/60 px-3 py-2 text-center text-xs text-fg"
    >
      <PauseCircle className="mt-px h-3.5 w-3.5 shrink-0 text-status-down" aria-hidden="true" />
      <span className="break-words">{suspendedBannerText(workspace)}</span>
    </p>
  );
}
