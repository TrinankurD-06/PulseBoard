import { zodResolver } from '@hookform/resolvers/zod';
import { Calculator } from 'lucide-react';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  buildAgentSchema,
  estimateAgentMonthlyRequests,
  externalCheckOptions,
  reportEveryOptions,
  requestsSavedVsPolling,
  SUGGESTED_EXTERNAL_CHECK_SEC,
  toAgentFormValues,
} from '../../lib/agent.js';
import { formatCount, formatDuration } from '../../lib/format.js';
import Button from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import Field from '../ui/Field.jsx';

/**
 * Create/edit form for an agent monitor: the customer's app reports to us, so
 * we need how often it reports, when a report counts as a failure, and
 * optionally a URL to probe when reports stop (and for a rare external check).
 * `onSubmit(values)` may throw an axios error; its field details are shown.
 */
export default function AgentForm({ monitor, submitLabel, onSubmit, onCancel }) {
  const schema = useMemo(() => buildAgentSchema(), []);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toAgentFormValues(monitor) });
  const [reportEverySec, probeUrl, externalCheckEverySec] = useWatch({
    control,
    name: ['reportEverySec', 'probeUrl', 'externalCheckEverySec'],
  });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      // The page already showed a toast; here we only attach field-level messages.
      for (const { path, message } of error?.response?.data?.error?.details ?? []) {
        setError(path || 'root', { message });
      }
    }
  });

  const monthly = estimateAgentMonthlyRequests(externalCheckEverySec);
  const silentAfter = Number(reportEverySec) * 2;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader
          title="App agent"
          description="The pulseboard-agent package in your Express app sends one small report per interval. Silence means your app is down."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Name"
            className="sm:col-span-2"
            placeholder="Shop API"
            error={errors.name?.message}
            {...register('name')}
          />
          <Field
            label="Report every"
            as="select"
            hint={
              Number.isFinite(silentAfter) && silentAfter > 0
                ? `Silence after ${formatDuration(silentAfter)} without a report`
                : undefined
            }
            error={errors.reportEverySec?.message}
            {...register('reportEverySec')}
          >
            {reportEveryOptions(monitor?.reportEverySec).map((sec) => (
              <option key={sec} value={sec}>
                {formatDuration(sec)}
              </option>
            ))}
          </Field>
          <Field
            label="Error rate threshold (%)"
            type="number"
            min={0}
            max={100}
            step="0.1"
            inputMode="decimal"
            hint="A report fails when 5xx responses exceed this share of requests"
            error={errors.errorRateThreshold?.message}
            {...register('errorRateThreshold')}
          />
          <Field
            label="p95 latency threshold (ms)"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="Off"
            hint="Optional: a report fails when its p95 is slower"
            error={errors.p95ThresholdMs?.message}
            {...register('p95ThresholdMs')}
          />
          <Field
            label="Probe URL"
            type="url"
            placeholder="https://shop.example.com/health"
            hint="Optional: checked (HEAD) only when reports stop, to tell a crashed app from a broken agent"
            error={errors.probeUrl?.message}
            {...register('probeUrl')}
          />
          <Field
            label="External check"
            as="select"
            className="sm:col-span-2"
            hint={
              probeUrl
                ? `Optional second opinion from outside your network. Every ${SUGGESTED_EXTERNAL_CHECK_SEC.map((sec) => formatDuration(sec)).join(' to ')} is plenty.`
                : 'Needs a probe URL'
            }
            error={errors.externalCheckEverySec?.message}
            {...register('externalCheckEverySec')}
          >
            <option value="">Off</option>
            {externalCheckOptions(monitor?.externalCheckEverySec).map((sec) => (
              <option key={sec} value={sec}>
                Every {formatDuration(sec)}
                {SUGGESTED_EXTERNAL_CHECK_SEC.includes(sec) ? ' (suggested)' : ''}
              </option>
            ))}
          </Field>
          <div className="flex items-start gap-2 rounded-card border border-line px-4 py-3 text-sm text-muted sm:col-span-2">
            <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
            <p>
              <span className="text-fg">
                ≈ {formatCount(monthly)} requests/month to your servers
              </span>{' '}
              · ≈ {formatCount(requestsSavedVsPolling(monthly))} saved vs checking every minute
              {probeUrl ? ' (probes only run while reports are missing)' : ''}
            </p>
          </div>
        </div>
      </Card>

      {errors.root?.message && <p className="text-sm text-status-down">{errors.root.message}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
