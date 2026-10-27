import { useState } from 'react';
import { cn } from '../../lib/cn.js';
import { RANGE_TEXT, formatMetricText, formatMetricValue } from '../../lib/health.js';
import HealthAreaChart from './HealthAreaChart.jsx';
import TimingChart from './TimingChart.jsx';
import { onGroupKeyDown } from './groupKeys.js';
import { cardLabelId } from './ids.js';

// Response-time cards that can show where the time went.
const TIMING_KEYS = new Set(['p95', 'avgResponse']);

function Stat({ label, value, unit }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-3">
      <dt className="text-[13px] text-faint">{label}</dt>
      <dd className="font-mono text-[13px] text-fg">{formatMetricText(value, unit)}</dd>
    </div>
  );
}

/** Full-width detail for the selected card: chart (or timing breakdown), current value, stats. */
export default function DetailPanel({ deckId, metric, timings, range }) {
  const [view, setView] = useState('chart');
  const hasTimings = TIMING_KEYS.has(metric.key) && Boolean(timings?.length);
  const activeView = hasTimings ? view : 'chart';
  const current = formatMetricValue(metric.current, metric.unit);

  return (
    <section
      aria-labelledby={cardLabelId(deckId, metric.key)}
      className="min-h-[22rem] rounded-card border border-line p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm text-fg">{metric.label}</h3>
          <p className="mt-0.5 text-xs text-muted">{RANGE_TEXT[range]}</p>
        </div>
        <p
          className="text-3xl leading-none font-light tracking-[-0.03em] text-fg tabular-nums"
          aria-label={`Current ${formatMetricText(metric.current, metric.unit)}`}
        >
          {current.text}
          {current.unit && <span className="ml-1 text-sm text-muted">{current.unit}</span>}
        </p>
      </div>

      {hasTimings && (
        <div
          role="tablist"
          aria-label="Chart view"
          onKeyDown={onGroupKeyDown}
          className="mt-4 flex gap-1.5"
        >
          {[
            ['chart', metric.label],
            ['timings', 'Timing breakdown'],
          ].map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${deckId}-tab-${id}`}
              aria-selected={activeView === id}
              tabIndex={activeView === id ? 0 : -1}
              onClick={() => setView(id)}
              className={cn(
                'rounded-pill border px-3 py-1 text-xs transition-colors motion-reduce:transition-none',
                activeView === id
                  ? 'border-line bg-surface-2 text-fg'
                  : 'border-transparent text-faint hover:text-fg',
              )}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div
          role={hasTimings ? 'tabpanel' : undefined}
          aria-labelledby={hasTimings ? `${deckId}-tab-${activeView}` : undefined}
          className="min-w-0"
        >
          {activeView === 'timings' ? (
            <TimingChart timings={timings} range={range} />
          ) : (
            <HealthAreaChart series={metric.series} unit={metric.unit} range={range} />
          )}
        </div>
        <dl className="divide-y divide-line self-start rounded-card border border-line">
          <Stat label="Peak" value={metric.peak} unit={metric.unit} />
          <Stat label="Average" value={metric.average} unit={metric.unit} />
          <Stat label="Low" value={metric.low} unit={metric.unit} />
        </dl>
      </div>
    </section>
  );
}
