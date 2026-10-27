import { useId } from 'react';
import { Link } from 'react-router-dom';

export default function Logo({ to = '/' }) {
  // Unique per instance: several logos can be on one page.
  const id = useId().replace(/:/g, '');
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold tracking-tight">
      {/* A raised tile: top-lit gradient, a thin highlight and a darker base edge. */}
      <svg
        viewBox="0 0 32 32"
        className="h-7 w-7 text-brand-400 drop-shadow-[0_2px_3px_rgb(74_45_20/0.35)] dark:drop-shadow-[0_0_6px_rgb(255_179_107/0.35)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2c22" />
            <stop offset="1" stopColor="#0a0706" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="#000" opacity="0.35" />
        <rect width="32" height="30.5" rx="8" fill={`url(#${id}-tile)`} />
        <rect
          x="0.75"
          y="0.75"
          width="30.5"
          height="29"
          rx="7.25"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.14"
          strokeWidth="1.5"
        />
        <path
          d="M4 17h6l3-7 5 13 3-6h7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      PulseBoard
    </Link>
  );
}
