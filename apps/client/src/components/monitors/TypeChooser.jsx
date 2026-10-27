import { Activity, Cpu, Globe } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import RingDot from '../ui/RingDot.jsx';

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
    text: 'Your app reports to us via an npm package. Real traffic, near-zero requests.',
  },
];

/** Radio-card choice of monitor type, shown at the top of "New monitor". */
export default function TypeChooser({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Monitor type" className="mb-8 grid gap-4 sm:grid-cols-3">
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
              'relative flex flex-col items-start gap-3 rounded-card border bg-transparent p-5 pr-11 text-left transition-[border-color,box-shadow] duration-200 ease-(--ease)',
              selected
                ? 'border-line-strong shadow-[inset_0_0_48px_-16px_var(--glow)]'
                : 'border-line hover:border-line-strong',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <RingDot className="absolute top-4 right-4" filled={selected} />
            <span className="flex w-full items-center gap-2">
              <Icon
                className={cn('h-4 w-4', selected ? 'text-fg' : 'text-faint')}
                aria-hidden="true"
              />
              <span className="text-fg">{title}</span>
              {badge && (
                <span className="ml-auto rounded-pill border border-line px-2 py-0.5 text-[11px] text-muted">
                  {badge}
                </span>
              )}
            </span>
            <span className="max-w-[30ch] text-sm text-muted">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
