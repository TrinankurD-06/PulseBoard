import { statusStyle } from '../../lib/status.js';
import Badge from '../ui/Badge.jsx';
import StatusDot from './StatusDot.jsx';

export default function StatusBadge({ status }) {
  const style = statusStyle(status);
  return (
    <Badge tone={style.tone} className="gap-1.5 px-2.5 py-1">
      <StatusDot status={status} />
      {style.label}
    </Badge>
  );
}
