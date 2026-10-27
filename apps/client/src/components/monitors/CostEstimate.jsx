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
      <p className="flex items-center gap-2 rounded-card border border-line px-4 py-3 text-sm text-muted">
        <Calculator className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
        <span>
          {adaptive ? 'At most ≈ ' : '≈ '}
          <span className="font-mono text-fg">{formatCount(requests)}</span> requests/month
          {cost != null && (
            <>
              {' · ≈ '}
              <span className="font-mono text-fg">{formatCurrency(cost, currency)}</span>/month
            </>
          )}
          {adaptive && (
            <span className="text-faint"> (fewer while the endpoint stays healthy)</span>
          )}
        </span>
      </p>
      {hint && (
        <p className="flex items-start gap-2 rounded-card border border-status-degraded/40 px-4 py-3 text-sm text-muted">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-status-degraded"
            aria-hidden="true"
          />
          <span>{hint}</span>
        </p>
      )}
    </div>
  );
}
