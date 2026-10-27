import { cn } from '../../lib/cn.js';
import Card from './Card.jsx';
import CountUp from './CountUp.jsx';

// Staircase: on desktop the tops step down 56px per card (padding-top on the
// column wrapper); on mobile the same step becomes a left offset.
const STEP = 56;

/**
 * Outline cards whose tops form a descending staircase (3 side by side on
 * desktop; stacked on mobile with the staircase kept as left offsets).
 * items: [{ value, unit, label, description, decimals? }]
 */
export default function SteppedCards({ items = [], className }) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-4 md:grid-cols-3 md:items-stretch md:gap-5', className)}
    >
      {items.map((item, i) => (
        <div
          key={item.label ?? i}
          className="animate-rise md:pt-(--step) md:pl-0 pl-(--offset)"
          style={{ '--i': i, '--step': `${i * STEP}px`, '--offset': `${i * 20}px` }}
        >
          <Card
            ringDot
            className="flex h-full min-h-[220px] flex-col justify-between gap-10 p-6 md:min-h-[260px]"
          >
            <div>
              <div
                className="font-light leading-none tracking-[-0.03em] text-fg"
                style={{ fontSize: 'clamp(40px, 5vw, 64px)' }}
              >
                <CountUp value={item.value} decimals={item.decimals} thousands />
                {item.unit && (
                  <span className="ml-[0.06em] text-muted" style={{ fontSize: '0.45em' }}>
                    {item.unit}
                  </span>
                )}
              </div>
              {item.label && <p className="mt-3 text-sm text-fg">{item.label}</p>}
            </div>
            {item.description && (
              <p className="max-w-[38ch] text-sm leading-relaxed text-muted">{item.description}</p>
            )}
          </Card>
        </div>
      ))}
    </div>
  );
}
