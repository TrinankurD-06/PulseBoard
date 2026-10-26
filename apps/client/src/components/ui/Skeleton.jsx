import { cn } from '../../lib/cn.js';

export default function Skeleton({ className }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-slate-200 dark:bg-slate-800', className)}
    />
  );
}
