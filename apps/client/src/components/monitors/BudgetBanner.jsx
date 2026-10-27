import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PauseCircle, Turtle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { analyticsKey, useUsage } from '../../api/analytics.js';
import { errorMessage } from '../../api/http.js';
import { useUpdateMonitor } from '../../api/monitors.js';
import {
  BUDGET_SLOW_INTERVAL_SEC,
  budgetSummary,
  isPausedByBudget,
  nextMonthLabel,
} from '../../lib/budget.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatDuration } from '../../lib/format.js';
import Button from '../ui/Button.jsx';
import Field from '../ui/Field.jsx';
import Modal from '../ui/Modal.jsx';

const currentMonth = () => new Date().toISOString().slice(0, 7);

function RaiseBudgetModal({ open, onClose, wid, monitor, used, budget }) {
  const queryClient = useQueryClient();
  const update = useUpdateMonitor(wid, monitor.id);
  const suggested = Math.max(budget * 2, used + 1000);
  const [value, setValue] = useState(String(suggested));
  const number = Number(value);
  const valid = Number.isInteger(number) && number > used;

  async function onSubmit(event) {
    event.preventDefault();
    if (!valid) return;
    try {
      await update.mutateAsync({ monthlyRequestBudget: number });
      await queryClient.invalidateQueries({ queryKey: analyticsKey(wid, monitor.id) });
      toast.success(`Monthly budget raised to ${formatCount(number)} requests`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Raise the monthly budget">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-muted">
          {formatCount(used)} of {formatCount(budget)} requests used this month. A budget above
          what&apos;s used lifts the {isPausedByBudget(monitor) ? 'pause' : 'slow-down'} right away.
        </p>
        <Field
          label="New monthly budget (requests)"
          type="number"
          min={used + 1}
          step={1}
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={
            value !== '' && !valid
              ? `Enter a whole number above ${formatCount(used)} (this month's usage)`
              : undefined
          }
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={update.isPending}>
            Raise budget
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Budget banner on the monitor page: warning at 80%, then what happened at
 * 100% (slowed or paused until next month). Members/owners can raise the
 * budget from here; viewers only see the banner.
 */
export default function BudgetBanner({ wid, monitor, canEdit }) {
  const { data: usage } = useUsage(wid, monitor.id);
  const [raising, setRaising] = useState(false);
  const summary = budgetSummary(usage);
  const pausedByBudget = isPausedByBudget(monitor);

  if (!summary && !pausedByBudget) return null;
  if (summary && summary.state === 'ok' && !pausedByBudget) return null;

  const month = usage?.month ?? currentMonth();
  const until = nextMonthLabel(month);
  const slowSec = usage?.interval?.currentIntervalSec ?? BUDGET_SLOW_INTERVAL_SEC;

  let tone = 'amber';
  let Icon = AlertTriangle;
  let title;
  let text;
  if (pausedByBudget) {
    tone = 'red';
    Icon = PauseCircle;
    title = 'Paused: monthly request budget reached';
    text = `No checks run until ${until}, or until the budget is raised.`;
  } else if (summary.exceeded) {
    Icon = Turtle;
    title = `Monthly budget reached: checking every ${formatDuration(slowSec)} until ${until}`;
    text = `${formatCount(summary.used)} of ${formatCount(summary.budget)} requests used (${summary.percent}%).`;
  } else {
    title = `${summary.percent}% of this month's request budget used`;
    text = `${formatCount(summary.used)} of ${formatCount(summary.budget)} requests. At 100% checks will ${
      summary.action === 'pause'
        ? 'pause'
        : `slow down to every ${formatDuration(BUDGET_SLOW_INTERVAL_SEC)}`
    } until ${until}.`;
  }

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-card border bg-transparent px-5 py-4',
        tone === 'red' ? 'border-status-down/40' : 'border-status-degraded/40',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          tone === 'red' ? 'text-status-down' : 'text-status-degraded',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-fg">{title}</p>
        <p className="mt-1 text-sm text-muted">{text}</p>
      </div>
      {canEdit && summary && (
        <Button variant="secondary" size="sm" onClick={() => setRaising(true)}>
          Raise budget
        </Button>
      )}
      {canEdit && summary && raising && (
        <RaiseBudgetModal
          open={raising}
          onClose={() => setRaising(false)}
          wid={wid}
          monitor={monitor}
          used={summary.used}
          budget={summary.budget}
        />
      )}
    </div>
  );
}
