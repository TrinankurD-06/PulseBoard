import { zodResolver } from '@hookform/resolvers/zod';
import { CURRENCIES, DEFAULT_CURRENCY, HTTP_METHODS } from '@pulseboard/shared/constants';
import { buildMonitorSchemas } from '@pulseboard/shared/schemas';
import { FlaskConical, Lightbulb, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorMessage } from '../../api/http.js';
import { useTestMonitorConfig } from '../../api/monitors.js';
import { DEFAULT_MAX_INTERVAL_SEC } from '../../lib/budget.js';
import { formatDuration } from '../../lib/format.js';
import Button from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import Field, { inputClasses } from '../ui/Field.jsx';
import Switch from '../ui/Switch.jsx';
import CostEstimate from './CostEstimate.jsx';
import TestResult from './TestResult.jsx';

const INTERVAL_PRESETS = [10, 30, 60, 120, 300, 600, 1800, 3600];

/** Number inputs and selects give strings; empty means "not set". */
const toNumberOrNull = (value) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value; // let the schema report junk
};

/**
 * Form values -> API payload. Headers are edited as rows but sent as an object.
 * With adaptive off, the fastest/slowest bounds are hidden, so they are
 * widened to include the base interval instead of failing validation.
 */
function toPayload(values) {
  const headers = Object.fromEntries(
    (values.headers ?? [])
      .filter((row) => row.name.trim())
      .map((row) => [row.name.trim(), row.value]),
  );
  const intervalSec = Number(values.intervalSec);
  let minIntervalSec = toNumberOrNull(values.minIntervalSec);
  let maxIntervalSec = toNumberOrNull(values.maxIntervalSec);
  if (!values.adaptive && Number.isFinite(intervalSec)) {
    minIntervalSec = Math.min(minIntervalSec ?? intervalSec, intervalSec);
    maxIntervalSec = Math.max(maxIntervalSec ?? intervalSec, intervalSec);
  }
  return {
    ...values,
    headers,
    minIntervalSec,
    maxIntervalSec,
    monthlyRequestBudget: toNumberOrNull(values.monthlyRequestBudget),
  };
}

function toFormValues(monitor, modeMinIntervalSec) {
  return {
    name: monitor?.name ?? '',
    url: monitor?.url ?? 'https://',
    // New monitors start with HEAD (headers only, cheapest for the customer);
    // existing monitors keep the method they have.
    method: monitor?.method ?? 'HEAD',
    intervalSec: String(monitor?.intervalSec ?? 60),
    timeoutMs: String(monitor?.timeoutMs ?? 10000),
    expectedStatus: {
      min: String(monitor?.expectedStatus?.min ?? 200),
      max: String(monitor?.expectedStatus?.max ?? 399),
    },
    keyword: monitor?.keyword ?? '',
    headers: Object.entries(monitor?.headers ?? {}).map(([name, value]) => ({ name, value })),
    costPer1kRequests: monitor?.costPer1kRequests == null ? '' : String(monitor.costPer1kRequests),
    currency: monitor?.currency ?? DEFAULT_CURRENCY,
    // Adaptive intervals are on by default for new monitors; existing ones keep theirs.
    adaptive: monitor ? Boolean(monitor.adaptive) : true,
    minIntervalSec: String(monitor?.minIntervalSec ?? modeMinIntervalSec),
    maxIntervalSec: String(monitor?.maxIntervalSec ?? DEFAULT_MAX_INTERVAL_SEC),
    monthlyRequestBudget:
      monitor?.monthlyRequestBudget == null ? '' : String(monitor.monthlyRequestBudget),
    budgetAction: monitor?.budgetAction ?? 'slow',
  };
}

/**
 * Create/edit form. Validation uses the same shared Zod schema as the API,
 * applied to the converted payload, so client and server rules can't drift.
 * `onSubmit(payload)` may throw an axios error; API field errors (e.g. the
 * SSRF check on `url`) are shown on the matching field.
 * "Test now" validates the form the same way, then runs a one-off check of
 * the current (unsaved) settings via the API.
 */
export default function MonitorForm({
  wid,
  monitor,
  minIntervalSec,
  submitLabel,
  onSubmit,
  onCancel,
}) {
  const schema = useMemo(() => {
    const { create } = buildMonitorSchemas({ demoMode: minIntervalSec < 30 });
    return z.preprocess(toPayload, create);
  }, [minIntervalSec]);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(monitor, minIntervalSec),
  });
  const headerRows = useFieldArray({ control, name: 'headers' });
  const [
    method,
    keyword,
    intervalSec,
    costPer1kRequests,
    currency,
    adaptive,
    monthlyRequestBudget,
    budgetAction,
  ] = useWatch({
    control,
    name: [
      'method',
      'keyword',
      'intervalSec',
      'costPer1kRequests',
      'currency',
      'adaptive',
      'monthlyRequestBudget',
      'budgetAction',
    ],
  });
  const headWithKeyword = method === 'HEAD' && Boolean(keyword?.trim());
  const testCheck = useTestMonitorConfig(wid);
  const [testResult, setTestResult] = useState(null);

  function showFieldErrors(error) {
    const details = error?.response?.data?.error?.details;
    if (Array.isArray(details)) {
      for (const { path, message } of details) setError(path || 'root', { message });
    }
  }

  const submit = handleSubmit(async (payload) => {
    try {
      await onSubmit(payload);
    } catch (error) {
      // The page already showed a toast; here we only attach field-level messages.
      showFieldErrors(error);
    }
  });

  const runTest = handleSubmit(async (payload) => {
    setTestResult(null);
    try {
      setTestResult(await testCheck.mutateAsync(payload));
    } catch (error) {
      toast.error(errorMessage(error));
      showFieldErrors(error);
    }
  });

  const intervalOptions = INTERVAL_PRESETS.filter((sec) => sec >= minIntervalSec);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader title="What to check" />
        <div className="grid gap-4 p-5 sm:grid-cols-[8rem_1fr]">
          <Field label="Method" as="select" error={errors.method?.message} {...register('method')}>
            {HTTP_METHODS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Field>
          <Field
            label="URL"
            type="url"
            placeholder="https://example.com/health"
            error={errors.url?.message}
            {...register('url')}
          />
          <Field
            label="Name"
            className="sm:col-span-2"
            placeholder="Production API"
            error={errors.name?.message}
            {...register('name')}
          />
          <p className="flex items-start gap-2 rounded-card border border-line px-4 py-3 text-sm text-muted sm:col-span-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
            <span>
              <span className="text-fg">Tip:</span> point PulseBoard at a lightweight{' '}
              <code className="text-xs">/health</code> endpoint that doesn&apos;t touch your
              database or paid services. Every check is a real request to your server;{' '}
              <Link
                to="/bot"
                target="_blank"
                className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
              >
                here&apos;s how to recognise them
              </Link>
              .
            </span>
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="How often" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Check every"
            as="select"
            error={errors.intervalSec?.message}
            {...register('intervalSec')}
          >
            {intervalOptions.map((sec) => (
              <option key={sec} value={sec}>
                {formatDuration(sec)}
              </option>
            ))}
          </Field>
          <Field
            label="Timeout (ms)"
            type="number"
            min={1000}
            step={500}
            hint="Fail the check if no response arrives in time"
            error={errors.timeoutMs?.message}
            {...register('timeoutMs')}
          />
          <Controller
            control={control}
            name="adaptive"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-4 rounded-card border border-line px-4 py-3 sm:col-span-2">
                <div>
                  <p className="text-sm text-fg">Adaptive interval</p>
                  <p className="mt-0.5 max-w-[52ch] text-xs text-faint">
                    Checks less often while everything is healthy (doubling after 10 good checks)
                    and speeds up straight away when something fails.
                  </p>
                </div>
                <Switch checked={field.value} onChange={field.onChange} label="Adaptive interval" />
              </div>
            )}
          />
          {adaptive && (
            <>
              <Field
                label="Fastest (when failing)"
                as="select"
                error={errors.minIntervalSec?.message}
                {...register('minIntervalSec')}
              >
                {intervalOptions.map((sec) => (
                  <option key={sec} value={sec}>
                    {formatDuration(sec)}
                  </option>
                ))}
              </Field>
              <Field
                label="Slowest (when healthy)"
                as="select"
                error={errors.maxIntervalSec?.message}
                {...register('maxIntervalSec')}
              >
                {intervalOptions.map((sec) => (
                  <option key={sec} value={sec}>
                    {formatDuration(sec)}
                  </option>
                ))}
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <CostEstimate
              intervalSec={intervalSec}
              costPer1kRequests={costPer1kRequests}
              currency={currency}
              adaptive={adaptive}
              monthlyRequestBudget={monthlyRequestBudget}
              budgetAction={budgetAction}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="When is it up?"
          description="All conditions must pass for a check to count as up."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Expected status from"
            type="number"
            error={errors.expectedStatus?.min?.message}
            {...register('expectedStatus.min')}
          />
          <Field
            label="Expected status to"
            type="number"
            error={errors.expectedStatus?.max?.message}
            {...register('expectedStatus.max')}
          />
          <Field
            label="Keyword (optional)"
            className="sm:col-span-2"
            placeholder='e.g. "ok" or "healthy"'
            hint={
              headWithKeyword
                ? 'Keyword checks need the response body: switch Method to GET.'
                : 'The response body must contain this text. Without a keyword no body is downloaded.'
            }
            error={errors.keyword?.message}
            {...register('keyword')}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Request headers"
          description="Optional, e.g. an API key the endpoint requires."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => headerRows.append({ name: '', value: '' })}
            >
              <Plus className="h-4 w-4" /> Add header
            </Button>
          }
        />
        <div className="space-y-3 p-5">
          {headerRows.fields.length === 0 && (
            <p className="text-sm text-muted">No custom headers.</p>
          )}
          {headerRows.fields.map((row, index) => (
            <div key={row.id} className="flex gap-2">
              <input
                aria-label="Header name"
                placeholder="X-Api-Key"
                className={inputClasses}
                {...register(`headers.${index}.name`)}
              />
              <input
                aria-label="Header value"
                placeholder="value"
                className={inputClasses}
                {...register(`headers.${index}.value`)}
              />
              <Button
                variant="ghost"
                onClick={() => headerRows.remove(index)}
                aria-label="Remove header"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {errors.headers?.message && (
            <p className="text-xs text-status-down">{errors.headers.message}</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Cost & budget"
          description="Optional. If your endpoint is billed per request, enter your price to see what monitoring costs you, and cap the requests PulseBoard may send each month."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-[1fr_8rem]">
          <Field
            label="Price per 1,000 requests"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="e.g. 10"
            error={errors.costPer1kRequests?.message}
            {...register('costPer1kRequests')}
          />
          <Field
            label="Currency"
            as="select"
            error={errors.currency?.message}
            {...register('currency')}
          >
            {CURRENCIES.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </Field>
          <Field
            label="Monthly request budget (optional)"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 20000"
            hint="At 80% of the budget your alert channels get a warning."
            className="sm:col-span-2"
            error={errors.monthlyRequestBudget?.message}
            {...register('monthlyRequestBudget')}
          />
          <Field
            label="When the budget is reached"
            as="select"
            className="sm:col-span-2"
            error={errors.budgetAction?.message}
            {...register('budgetAction')}
          >
            <option value="slow">Slow down to every 15 min until next month</option>
            <option value="pause">Pause until next month</option>
          </Field>
        </div>
      </Card>

      {errors.root?.message && <p className="text-sm text-status-down">{errors.root.message}</p>}

      {testResult && <TestResult result={testResult} />}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          className="mr-auto"
          loading={testCheck.isPending}
          onClick={runTest}
        >
          {!testCheck.isPending && <FlaskConical className="h-4 w-4" />} Test now
        </Button>
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
