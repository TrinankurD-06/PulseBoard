import RingDot from './RingDot.jsx';

/**
 * Thin headline, a muted line and the action (pass a RingDotCta). `icon` is
 * accepted for backwards compatibility and ignored: the ring-dot is the icon.
 */
export default function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line px-6 py-16 text-center">
      <RingDot className="mb-6" />
      <h3 className="text-2xl font-light tracking-[-0.02em] text-fg">{title}</h3>
      {description && <p className="mt-2 max-w-[38ch] text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
