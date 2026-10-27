import { OFFLINE_LABEL } from '../../lib/health.js';

/** Legend entry for the muted "Checker offline" band: swatch + label. */
export default function OfflineLegend({ className = 'mb-2' }) {
  return (
    <p className={`${className} flex items-center gap-1.5 text-xs text-muted`}>
      <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-faint/30" />
      {OFFLINE_LABEL}
    </p>
  );
}
