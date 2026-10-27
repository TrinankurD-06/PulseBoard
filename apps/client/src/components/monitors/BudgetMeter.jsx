import { formatCount } from '../../lib/format.js';

const TONES = {
  ok: { bar: 'bg-status-up', label: 'Within budget' },
  warning: { bar: 'bg-status-pending', label: 'Nearly used up' },
  exceeded: { bar: 'bg-status-down', label: 'Budget reached' },
};

/**
 * Monthly budget usage from budgetSummary(): text label + percentage, the bar
 * colour is only a reinforcement. `compact` fits a table cell.
 */
export default function BudgetMeter({ summary, compact = false }) {
  const tone = TONES[summary.exceeded ? 'exceeded' : summary.state] ?? TONES.ok;
  const width = Math.min(100, summary.percent);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="text-slate-500">
          {compact
            ? `${formatCount(summary.used)} / ${formatCount(summary.budget)}`
            : `Monthly budget: ${formatCount(summary.used)} of ${formatCount(summary.budget)} requests`}
        </span>
        <span className="font-medium">
          {summary.percent}% · {tone.label}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-label="Monthly request budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-valuetext={`${summary.percent}%, ${tone.label}`}
      >
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
