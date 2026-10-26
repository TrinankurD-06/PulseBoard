import { estimateMonthlyCost, estimateMonthlyRequests } from '@pulseboard/shared/cost';
import { AlertTriangle, Calculator } from 'lucide-react';
import { budgetHint } from '../../lib/budget.js';
import { formatCount, formatCurrency } from '../../lib/format.js';

/**
 * Live "≈ 43,200 requests/month · ≈ ₹432/month" line for the monitor form.
 * Uses the same shared estimator as the API, so form and detail page agree.
 * With adaptive intervals the base interval is an upper bound ("at most"),
 * and a budget smaller than the estimate gets a warning hint.
 */
export default function CostEstimate({
  intervalSec,
  costPer1kRequests,
  currency,
  adaptive = false,
  monthlyRequestBudget,
  budgetAction,
}) {
  const monitor = {
    type: 'http',
    intervalSec: Number(intervalSec),
    costPer1kRequests: costPer1kRequests === '' ? null : Number(costPer1kRequests),
  };
  const requests = estimateMonthlyRequests(monitor);
  const cost = estimateMonthlyCost(monitor);
  const budget = Number(monthlyRequestBudget) || null;
  const hint = budgetHint(requests, budget, budgetAction);

  return (
    <div className="space-y-2" aria-live="polite">
      <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        <Calculator className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span>
          {adaptive ? 'At most ≈ ' : '≈ '}
          <span className="font-medium">{formatCount(requests)}</span> requests/month
          {cost != null && (
            <>
              {' · ≈ '}
              <span className="font-medium">{formatCurrency(cost, currency)}</span>/month
            </>
          )}
          {adaptive && (
            <span className="text-slate-500"> (fewer while the endpoint stays healthy)</span>
          )}
        </span>
      </p>
      {hint && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>{hint}</span>
        </p>
      )}
    </div>
  );
}
