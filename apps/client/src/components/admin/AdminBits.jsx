import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import { timeAgo } from '../../lib/format.js';
import Card from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';

/** One headline number: label, the value, and an optional line under it. A link when `to` is set. */
export function StatTile({ label, value, hint, to, tone }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p
        className={cn(
          'mt-3 text-4xl leading-none font-light tracking-[-0.03em] tabular-nums',
          tone === 'red' ? 'text-status-down' : 'text-fg',
        )}
      >
        {value ?? '—'}
      </p>
      {hint && <p className="mt-2 text-xs text-faint">{hint}</p>}
    </>
  );
  return to ? (
    <Link
      to={to}
      className="block rounded-card border border-line bg-surface p-5 transition-[border-color,box-shadow] duration-200 ease-(--ease) hover:border-line-strong hover:shadow-[inset_0_0_48px_-16px_var(--glow)]"
    >
      {body}
    </Link>
  ) : (
    <Card className="p-5">{body}</Card>
  );
}

/** A relative time ("5 minutes ago") that shows the exact time on hover; "never" when empty. */
export function When({ value, now, empty = 'Never' }) {
  if (!value) return <span className="text-faint">{empty}</span>;
  return (
    <time dateTime={value} title={new Date(value).toLocaleString()}>
      {timeAgo(value, now)}
    </time>
  );
}

/** A label above a value, for definition lists. */
export function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

/** The grid that holds Facts. */
const FACT_COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

export function Facts({ children, cols = 3, className }) {
  const columns = cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : FACT_COLUMNS[cols];
  return <dl className={cn('grid grid-cols-1 gap-x-8 gap-y-5', columns, className)}>{children}</dl>;
}

/** A quiet in-link, used for names that lead to a detail page. */
export function TextLink({ className, ...props }) {
  return (
    <Link
      className={cn(
        'text-fg underline decoration-transparent underline-offset-4 transition-colors duration-200 hover:text-brand hover:decoration-current',
        className,
      )}
      {...props}
    />
  );
}

export function LoadingRows({ rows = 4, className }) {
  return (
    <div className={cn('space-y-3 p-5', className)} role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

/** What a failed admin request looks like; a 404 means the thing is gone. */
export function ErrorLine({ error, what = 'this' }) {
  const gone = error?.response?.status === 404;
  return (
    <p role="alert" className="p-5 text-sm text-status-down">
      {gone ? `We couldn't find ${what}.` : `Couldn't load ${what}.`}
    </p>
  );
}

/** A small spinner shown while a list refetches under the old data. */
export function Refreshing({ active }) {
  return active ? (
    <Loader2 className="h-4 w-4 animate-spin text-faint" aria-label="Refreshing" role="img" />
  ) : null;
}
