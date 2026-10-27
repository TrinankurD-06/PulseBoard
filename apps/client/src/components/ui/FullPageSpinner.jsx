import RingDot from './RingDot.jsx';

export default function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <RingDot size={28} className="animate-pulse text-line-strong motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
