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
        'rounded-card border bg-transparent p-5',
        result.ok ? 'border-line-strong' : 'border-status-down/40',
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span
          className={cn(
            'flex items-center gap-1.5',
            result.ok ? 'text-status-up' : 'text-status-down',
          )}
        >
          <Icon className="h-4 w-4" /> {result.ok ? 'Check passed' : 'Check failed'}
        </span>
        {result.statusCode != null && (
          <span className="font-mono text-sm text-fg">HTTP {result.statusCode}</span>
        )}
        <span className="font-mono text-sm text-faint">{formatMs(result.totalMs)} total</span>
      </div>
      {result.error && <p className="mt-2 text-sm text-status-down">{result.error}</p>}
      {result.timings && (
        <div className="mt-4">
          <TimingBar timings={result.timings} />
        </div>
      )}
    </div>
  );
}
