import { Info } from 'lucide-react';
import { useUsage } from '../../api/analytics.js';
import { budgetSummary } from '../../lib/budget.js';
import { formatCount, formatCurrency, formatMonth } from '../../lib/format.js';
import Card, { CardHeader } from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import BudgetMeter from './BudgetMeter.jsx';

function Row({ label, children, hint }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 text-sm text-fg">{children}</dd>
      {hint && <dd className="mt-0.5 text-xs text-faint">{hint}</dd>}
    </div>
  );
}

/** Monthly budget usage, when the monitor has a budget. */
function BudgetBar({ usage }) {
  const summary = budgetSummary(usage);
  if (!summary) return null;
  return (
    <div className="mx-5 mb-5">
      <BudgetMeter summary={summary} />
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
      {isError && <p className="p-5 text-sm text-muted">Usage isn&apos;t available yet.</p>}
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
                <span className="text-muted">No price set (edit the monitor to add one)</span>
              </Row>
            )}
            <Row label="Request method">
              {usage.method === 'HEAD' && usage.headUnsupported ? 'GET' : usage.method}
            </Row>
          </dl>
          <BudgetBar usage={usage} />
          {usage.headUnsupported && (
            <p className="mx-5 mb-5 flex gap-2 rounded-card border border-line px-4 py-3 text-xs text-muted">
              <Info className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
              This server doesn&apos;t support HEAD requests, so checks use GET (headers only, the
              body is not downloaded).
            </p>
          )}
        </>
      )}
    </Card>
  );
}
