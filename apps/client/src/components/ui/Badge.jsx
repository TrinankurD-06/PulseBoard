import { cn } from '../../lib/cn.js';

const TONES = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-400',
};

export default function Badge({ tone = 'neutral', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
