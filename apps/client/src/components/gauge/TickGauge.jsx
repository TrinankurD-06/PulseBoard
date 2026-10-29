import { cn } from '../../lib/cn.js';
import {
  TICK_COUNT,
  filledTickCount,
  formatGaugeNumber,
  gaugeState,
  gaugeSummary,
  polarPoint,
  tickLine,
} from '../../lib/gauge.js';
import useEnterProgress from '../ui/useEnterProgress.js';

// Geometry in a 240 x 240 viewBox: ticks 16 long, a small dot just outside each lit tick.
const C = 120;
const R_INNER = 90;
const R_OUTER = 106;
const R_DOT = 113;

const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => {
  const line = tickLine(i, { cx: C, cy: C, rInner: R_INNER, rOuter: R_OUTER });
  const dot = polarPoint(C, C, R_DOT, line.angle);
  return { ...line, dx: dot.x, dy: dot.y };
});

/**
 * A ring of 60 thin ticks filled clockwise from 12 o'clock to value/max. Lit
 * ticks are --text with a small --accent dot at their outer end; the rest are
 * --line. With a `target` on the wrong side the lit part turns --status-down, or
 * --status-degraded while the value is still within `warnTarget`.
 * The number in the middle counts up as the ticks light, once, on mount.
 * `size` is the maximum width: the gauge shrinks with its container.
 * A null `value` is the empty state: no lit ticks and `emptyText` ("No data yet")
 * in the middle instead of a number.
 */
export default function TickGauge({
  value,
  max = 100,
  label,
  caption,
  unit = '%',
  target,
  thresholdDirection = 'above',
  warnTarget,
  size = 240,
  decimals,
  ariaLabel,
  emptyText = 'No data yet',
  className,
}) {
  const progress = useEnterProgress(800);
  const empty = value == null;
  const filled = filledTickCount(value, max);
  const lit = Math.round(filled * progress);
  const state = gaugeState({ value, target, direction: thresholdDirection, warnTarget });
  const tone = { down: 'var(--status-down)', warn: 'var(--status-degraded)' }[state];
  const litColor = tone ?? 'var(--series)';
  const dotColor = tone ?? 'var(--accent)';

  const safeValue = Number.isFinite(value) ? value : 0;
  const number = formatGaugeNumber(safeValue * (progress >= 1 ? 1 : progress), { decimals });
  const summary =
    ariaLabel ??
    (empty ? `${label ?? 'Value'}: ${emptyText}` : null) ??
    gaugeSummary({ label, value, unit, target, direction: thresholdDirection, decimals, max });

  return (
    <div
      role="img"
      aria-label={summary}
      className={cn('relative mx-auto w-full [container-type:inline-size]', className)}
      style={{ maxWidth: size }}
    >
      <svg viewBox="0 0 240 240" className="block aspect-square w-full" aria-hidden="true">
        {TICKS.map((t, i) => {
          const on = i < lit;
          return (
            <g key={i}>
              <line
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={on ? litColor : 'var(--line)'}
                strokeWidth={on ? 1.5 : 1.25}
                strokeLinecap="round"
              />
              {on && <circle cx={t.dx} cy={t.dy} r="1.25" fill={dotColor} />}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div
          className="font-light leading-none tracking-[-0.03em] text-fg tabular-nums"
          style={{ fontSize: 'clamp(26px, 23cqw, 64px)' }}
        >
          {empty ? (
            <span className="text-muted" style={{ fontSize: '0.5em' }}>
              {emptyText}
            </span>
          ) : (
            number
          )}
          {!empty && unit && (
            <span className="ml-[0.06em] align-baseline text-muted" style={{ fontSize: '0.45em' }}>
              {unit}
            </span>
          )}
        </div>
        {(label || caption) && (
          <div className="mt-[3cqw] flex max-w-[56%] flex-col gap-0.5 leading-snug">
            {label && (
              <span className="text-muted" style={{ fontSize: 'clamp(10px, 5.4cqw, 13px)' }}>
                {label}
              </span>
            )}
            {caption && (
              <span className="text-faint" style={{ fontSize: 'clamp(9px, 4.6cqw, 11px)' }}>
                {caption}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
