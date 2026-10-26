import { CheckCircle2, XCircle } from 'lucide-react';
import { formatMs } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';
import TimingBar from './TimingBar.jsx';

/** Result of a one-off "Test now" check. */
export default function TestResult({ result }) {
  const Icon = result.ok ? CheckCircle2 : XCircle;
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        result.ok
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/5'
          : 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/5',
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span
          className={cn(
            'flex items-center gap-1.5 font-semibold',
            result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
          )}
        >
          <Icon className="h-5 w-5" /> {result.ok ? 'Check passed' : 'Check failed'}
        </span>
        {result.statusCode != null && <span className="text-sm">HTTP {result.statusCode}</span>}
        <span className="text-sm text-slate-500">{formatMs(result.totalMs)} total</span>
      </div>
      {result.error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{result.error}</p>
      )}
      {result.timings && (
        <div className="mt-4">
          <TimingBar timings={result.timings} />
        </div>
      )}
    </div>
  );
}
