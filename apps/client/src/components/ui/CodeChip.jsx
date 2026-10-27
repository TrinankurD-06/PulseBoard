import { cn } from '../../lib/cn.js';

/** A failure's machine-readable code (ETIMEDOUT, HTTP_503...) as a small mono chip. */
export default function CodeChip({ children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line px-1.5 py-0.5 align-middle font-mono text-[11px] leading-none text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
