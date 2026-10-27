import { cn } from '../../lib/cn.js';

/** Placeholder block: --surface-2 with a slow light sweep. */
export default function Skeleton({ className }) {
  return (
    <div aria-hidden="true" className={cn('animate-shimmer rounded-md bg-surface-2', className)} />
  );
}
