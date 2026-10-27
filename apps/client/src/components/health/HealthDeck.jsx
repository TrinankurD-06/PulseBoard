import { useId, useState } from 'react';
import { errorMessage } from '../../api/http.js';
import { useMetrics } from '../../api/metrics.js';
import { cn } from '../../lib/cn.js';
import { DEFAULT_HEALTH_RANGE, HEALTH_RANGES, resolveSelection } from '../../lib/health.js';
import DetailPanel from './DetailPanel.jsx';
import MetricCard from './MetricCard.jsx';
import { onGroupKeyDown } from './groupKeys.js';

const PANEL_HEIGHT = 'min-h-[22rem]';
const GHOST_CARDS = 4;

function RangeControl({ range, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      onKeyDown={onGroupKeyDown}
      className="inline-flex rounded-pill border border-line p-0.5"
    >
      {HEALTH_RANGES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={range === value}
          tabIndex={range === value ? 0 : -1}
          onClick={() => onChange(value)}
          className={cn(
            'rounded-pill px-3 py-1 font-mono text-xs transition-colors duration-200 motion-reduce:transition-none',
            range === value ? 'bg-surface-2 text-fg' : 'text-faint hover:text-fg',
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

const block = 'animate-shimmer rounded-md bg-surface-2';

function SkeletonCard() {
  return (
    <div className="relative h-40 overflow-hidden rounded-card border border-line p-5">
      <div className={cn(block, 'h-4 w-24')} />
      <div className={cn(block, 'mt-4 h-8 w-32')} />
      <div className="absolute inset-x-0 bottom-0 h-10 bg-surface-2" />
    </div>
  );
}

function GhostCard() {
  return <div className="h-40 rounded-card border border-dashed border-line" />;
}

/** Same footprint as the real panel, with a quiet message (empty, error) or a skeleton. */
function PanelBlock({ children, skeleton }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-card border border-line p-5 text-center',
        PANEL_HEIGHT,
      )}
    >
      {skeleton ? <div className={cn(block, 'h-64 w-full')} /> : children}
    </div>
  );
}

/**
 * The Health deck: metric cards for the monitor's type with a detail panel
 * for the selected one. Data comes from useMetrics; live check results are
 * folded into its cache elsewhere (realtime/metricsLive).
 */
export default function HealthDeck({ wid, monitorId }) {
  const deckId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [range, setRange] = useState(DEFAULT_HEALTH_RANGE);
  const [selected, setSelected] = useState(null);
  const { data, isPending, error, refetch, isFetching, isPlaceholderData } = useMetrics(
    wid,
    monitorId,
    range,
  );

  const metrics = data?.metrics ?? [];
  const keys = metrics.map((m) => m.key);
  const key = resolveSelection(keys, selected);
  const metric = metrics.find((m) => m.key === key);
  const showError = Boolean(error) && !data;
  const showEmpty = Boolean(data?.empty);
  const showSkeleton = isPending && !showError;
  const ghostCount = metrics.length || GHOST_CARDS;

  return (
    <section aria-labelledby={`${deckId}-title`} className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`${deckId}-title`}
            className="font-heading text-[clamp(28px,3.5vw,40px)] leading-[1.05] font-light tracking-[-0.03em] text-fg"
          >
            Health.
          </h2>
          <p className="mt-2 text-sm text-muted">
            Live signals for this monitor. Select a card for detail.
          </p>
        </div>
        <RangeControl range={range} onChange={setRange} />
      </header>

      {showSkeleton || showError || showEmpty ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2" aria-hidden={showSkeleton || undefined}>
            {Array.from({ length: ghostCount }, (_, i) =>
              showSkeleton ? <SkeletonCard key={i} /> : <GhostCard key={i} />,
            )}
          </div>
          <PanelBlock skeleton={showSkeleton}>
            {showError ? (
              <div role="alert" className="space-y-3">
                <p className="text-sm text-fg">Couldn&apos;t load the health signals.</p>
                <p className="text-xs text-muted">{errorMessage(error)}</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="h-8 rounded-pill border border-line-strong px-4 text-[13px] text-fg transition-colors hover:bg-surface-2 motion-reduce:transition-none"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div role="status" className="space-y-1">
                <p className="text-sm text-fg">Collecting data…</p>
                <p className="text-xs text-muted">
                  The first results arrive within about a minute.
                </p>
              </div>
            )}
          </PanelBlock>
        </>
      ) : (
        <div
          className={cn(
            'space-y-4 transition-opacity motion-reduce:transition-none',
            isPlaceholderData && isFetching && 'opacity-60',
          )}
          aria-busy={isPlaceholderData || undefined}
        >
          <div
            role="radiogroup"
            aria-label="Health metrics"
            onKeyDown={onGroupKeyDown}
            className="grid gap-4 sm:grid-cols-2"
          >
            {metrics.map((m) => (
              <MetricCard
                key={m.key}
                deckId={deckId}
                metric={m}
                selected={m.key === key}
                tabbable={m.key === key}
                onSelect={setSelected}
              />
            ))}
          </div>
          {metric && (
            <DetailPanel
              deckId={deckId}
              metric={metric}
              timings={data.timings}
              failures={data.failures}
              sample={data.includesSampleData}
              range={range}
            />
          )}
        </div>
      )}
    </section>
  );
}
