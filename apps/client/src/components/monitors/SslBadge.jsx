import { ShieldAlert, ShieldCheck } from 'lucide-react';
import Badge from '../ui/Badge.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS = 14;

/**
 * TLS certificate expiry: green when healthy, amber within 14 days, red once expired.
 * `now` comes from the caller (useNow) so rendering stays pure.
 */
export default function SslBadge({ expiresAt, now }) {
  if (!expiresAt) return null;
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - now) / DAY_MS);
  const date = new Date(expiresAt).toLocaleDateString();

  if (daysLeft < 0) {
    return (
      <Badge tone="red" className="gap-1">
        <ShieldAlert className="h-3.5 w-3.5" /> SSL expired {date}
      </Badge>
    );
  }
  return (
    <Badge
      tone={daysLeft <= WARN_DAYS ? 'amber' : 'green'}
      className="gap-1"
      title={`Certificate expires ${date}`}
    >
      {daysLeft <= WARN_DAYS ? (
        <ShieldAlert className="h-3.5 w-3.5" />
      ) : (
        <ShieldCheck className="h-3.5 w-3.5" />
      )}
      SSL {daysLeft === 0 ? 'expires today' : `${daysLeft} days left`}
    </Badge>
  );
}
