import { cn } from '../../lib/cn.js';

export const SAMPLE_TITLE = 'Created by the demo seed; npm run seed:clear removes it';

/** Small pill marking sample (demo seed) data next to a title, card or row. */
export default function SampleBadge({ className }) {
  return (
    <span
      title={SAMPLE_TITLE}
      className={cn(
        'inline-flex h-5 items-center rounded-pill border border-line px-2 text-[11px] leading-none whitespace-nowrap text-faint',
        className,
      )}
    >
      Sample data
    </span>
  );
}
