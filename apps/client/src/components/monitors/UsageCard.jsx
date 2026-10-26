import { Info } from 'lucide-react';
import { useUsage } from '../../api/analytics.js';
import { formatCount, formatCurrency, formatMonth } from '../../lib/format.js';
import Card, { CardHeader } from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';

function Row({ label, children, hint }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
}

/**
 * "Requests & cost": what PulseBoard actually sent to this endpoint this month
 * (MonitorUsage) next to the estimate, plus costs when the customer set a price.
 */
export default function UsageCard({ wid, monitorId }) {
  const { data: usage, isPending, isError } = useUsage(wid, monitorId);

  return (
    <Card>
      <CardHeader
        title="Requests & cost"
        description={usage ? formatMonth(usage.month) : 'This month'}
      />
      {isPending && (
        <div className="grid grid-cols-2 gap-4 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}
      {isError && <p className="p-5 text-sm text-slate-500">Usage isn&apos;t available yet.</p>}
      {usage && (
        <>
          <dl className="grid grid-cols-2 gap-4 p-5">
            <Row
              label="Requests sent"
              hint={`Estimate so far ≈ ${formatCount(usage.estimatedSoFar)}`}
            >
              {formatCount(usage.requests)}
            </Row>
            <Row label="Monthly estimate">≈ {formatCount(usage.estimatedMonthly)}</Row>
            {usage.costPer1kRequests != null ? (
              <>
                <Row label="Cost this month">
                  {formatCurrency(usage.actualCost, usage.currency)}
                </Row>
                <Row
                  label="Estimated monthly cost"
                  hint={`at ${formatCurrency(usage.costPer1kRequests, usage.currency)} per 1,000 requests`}
                >
                  ≈ {formatCurrency(usage.estimatedMonthlyCost, usage.currency)}
                </Row>
              </>
            ) : (
              <Row label="Cost">
                <span className="font-normal text-slate-500">
                  No price set (edit the monitor to add one)
                </span>
              </Row>
            )}
            <Row label="Request method">
              {usage.method === 'HEAD' && usage.headUnsupported ? 'GET' : usage.method}
            </Row>
          </dl>
          {usage.headUnsupported && (
            <p className="mx-5 mb-5 flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <Info className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              This server doesn&apos;t support HEAD requests, so checks use GET (headers only, the
              body is not downloaded).
            </p>
          )}
        </>
      )}
    </Card>
  );
}
