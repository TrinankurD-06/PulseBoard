import { cn } from '../../lib/cn.js';
import { formatChange, formatMetricValue } from '../../lib/health.js';
import RingDot from '../ui/RingDot.jsx';
import HealthSparkline from './HealthSparkline.jsx';
import { cardLabelId } from './ids.js';

/**
 * One metric: label, change vs the previous period, big value and a sparkline
 * along the bottom edge. A radio of the deck's radiogroup (roving tabindex;
 * the deck handles the keys). The sparkline is decorative.
 */
export default function MetricCard({ deckId, metric, selected, tabbable, onSelect }) {
  const value = formatMetricValue(metric.value, metric.unit);
  const change = formatChange(metric.change, metric.key);

  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-labelledby={cardLabelId(deckId, metric.key)}
      aria-describedby={`${deckId}-value-${metric.key}`}
      tabIndex={tabbable ? 0 : -1}
      data-key={metric.key}
      onClick={() => onSelect(metric.key)}
      className={cn(
        'relative h-40 cursor-pointer overflow-hidden rounded-card border bg-transparent text-left transition-[border-color,box-shadow] duration-200 ease-(--ease) motion-reduce:transition-none',
        selected
          ? 'border-line-strong shadow-[inset_0_0_48px_-16px_var(--glow)]'
          : 'border-line hover:border-line-strong',
      )}
    >
      <RingDot className="absolute top-4 right-4 z-10" filled={selected} />
      <div className="relative z-10 flex items-baseline gap-3 px-5 pt-4 pr-11">
        <span id={cardLabelId(deckId, metric.key)} className="text-sm text-muted">
          {metric.label}
        </span>
        <span
          className={cn(
            'font-mono text-[11px] whitespace-nowrap',
            change.bad ? 'text-status-down' : 'text-faint',
          )}
          data-direction={change.direction}
        >
          {change.arrow && <span aria-hidden="true">{change.arrow} </span>}
          {change.text}
          <span className="sr-only">
            {change.direction === 'up' && ' increase'}
            {change.direction === 'down' && ' decrease'}
            {change.direction === 'none' && ' no comparison'} versus the previous period
          </span>
        </span>
      </div>
      <p
        id={`${deckId}-value-${metric.key}`}
        className="relative z-10 mt-3 px-5 text-4xl leading-none font-light tracking-[-0.03em] text-fg tabular-nums"
      >
        {value.text}
        {value.unit && <span className="ml-1 text-sm text-muted">{value.unit}</span>}
      </p>
      <div className="absolute inset-x-0 bottom-0 h-16">
        <HealthSparkline series={metric.series} unit={metric.unit} />
      </div>
    </div>
  );
}
