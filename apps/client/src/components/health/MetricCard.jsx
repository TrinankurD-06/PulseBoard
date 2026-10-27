import { cn } from '../../lib/cn.js';
import { formatChange, formatMetricValue } from '../../lib/health.js';
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
        'relative h-40 cursor-pointer overflow-hidden rounded-lg border text-left transition-colors motion-reduce:transition-none',
        selected
          ? 'border-line-strong bg-surface-2'
          : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <div className="relative z-10 flex items-start justify-between gap-3 px-4 pt-4">
        <span id={cardLabelId(deckId, metric.key)} className="text-sm text-muted">
          {metric.label}
        </span>
        <span
          className={cn(
            'font-mono text-xs whitespace-nowrap',
            change.bad ? 'text-status-down' : 'text-muted',
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
        className="relative z-10 mt-2 px-4 font-mono text-3xl font-medium tracking-tight text-fg"
      >
        {value.text}
        {value.unit && <span className="ml-1 text-sm font-normal text-muted">{value.unit}</span>}
      </p>
      <div className="absolute inset-x-0 bottom-0 h-16">
        <HealthSparkline series={metric.series} unit={metric.unit} />
      </div>
    </div>
  );
}
