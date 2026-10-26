import { Link } from 'react-router-dom';

export default function Logo({ to = '/' }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-slate-900 dark:fill-slate-800" />
        <path
          d="M4 17h6l3-7 5 13 3-6h7"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      PulseBoard
    </Link>
  );
}
