import { estimateMonthlyCost, estimateMonthlyRequests } from '@pulseboard/shared/cost';
import { Calculator } from 'lucide-react';
import { formatCount, formatCurrency } from '../../lib/format.js';

/**
 * Live "≈ 43,200 requests/month · ≈ ₹432/month" line for the monitor form.
 * Uses the same shared estimator as the API, so form and detail page agree.
 */
export default function CostEstimate({ intervalSec, costPer1kRequests, currency }) {
  const monitor = {
    type: 'http',
    intervalSec: Number(intervalSec),
    costPer1kRequests: costPer1kRequests === '' ? null : Number(costPer1kRequests),
  };
  const requests = estimateMonthlyRequests(monitor);
  const cost = estimateMonthlyCost(monitor);

  return (
    <p
      className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
      aria-live="polite"
    >
      <Calculator className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      <span>
        ≈ <span className="font-medium">{formatCount(requests)}</span> requests/month
        {cost != null && (
          <>
            {' · ≈ '}
            <span className="font-medium">{formatCurrency(cost, currency)}</span>/month
          </>
        )}
      </span>
    </p>
  );
}
