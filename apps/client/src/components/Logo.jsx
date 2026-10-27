import { Link } from 'react-router-dom';
import { cn } from '../lib/cn.js';

/** Plain wordmark: Manrope 500, no mark. */
export default function Logo({ to = '/', className }) {
  return (
    <Link to={to} className={cn('text-[15px] font-medium tracking-[-0.02em] text-fg', className)}>
      PulseBoard
    </Link>
  );
}
