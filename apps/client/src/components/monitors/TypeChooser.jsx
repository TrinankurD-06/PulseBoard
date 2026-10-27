import { Activity, Cpu, Globe } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const TYPES = [
  {
    value: 'http',
    icon: Globe,
    title: 'Website / API',
    text: 'We check it on a schedule.',
  },
  {
    value: 'heartbeat',
    icon: Activity,
    title: 'Heartbeat',
    text: 'Your cron job or worker pings us. Zero requests to your servers.',
  },
  {
    value: 'agent',
    icon: Cpu,
    title: 'App agent',
    text: 'An npm package reports from inside your app.',
    disabled: true,
    badge: 'Coming soon',
  },
];

/** Radio-card choice of monitor type, shown at the top of "New monitor". */
export default function TypeChooser({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Monitor type" className="mb-6 grid gap-3 sm:grid-cols-3">
      {TYPES.map(({ value: type, icon: Icon, title, text, disabled, badge }) => {
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={() => onChange(type)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors',
              selected
                ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 dark:bg-emerald-500/10'
                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700',
              disabled &&
                'cursor-not-allowed opacity-60 hover:border-slate-200 dark:hover:border-slate-800',
            )}
          >
            <span className="flex w-full items-center gap-2">
              <Icon
                className={cn(
                  'h-4 w-4',
                  selected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500',
                )}
                aria-hidden="true"
              />
              <span className="font-medium">{title}</span>
              {badge && (
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {badge}
                </span>
              )}
            </span>
            <span className="text-sm text-slate-500">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
