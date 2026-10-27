import { formatCount } from '../../lib/format.js';

const TONES = {
  ok: { bar: 'bg-status-up', label: 'Within budget' },
  warning: { bar: 'bg-status-degraded', label: 'Nearly used up' },
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
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="text-faint">
          {compact
            ? `${formatCount(summary.used)} / ${formatCount(summary.budget)}`
            : `Monthly budget: ${formatCount(summary.used)} of ${formatCount(summary.budget)} requests`}
        </span>
        <span className="font-mono text-muted">
          {summary.percent}% · {tone.label}
        </span>
      </div>
      <div
        className="h-px w-full bg-line-strong"
        role="progressbar"
        aria-label="Monthly request budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-valuetext={`${summary.percent}%, ${tone.label}`}
      >
        <div className={`-mt-px h-0.5 ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
