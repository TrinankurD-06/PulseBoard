import { zodResolver } from '@hookform/resolvers/zod';
import { CURRENCIES, DEFAULT_CURRENCY, HTTP_METHODS } from '@pulseboard/shared/constants';
import { buildMonitorSchemas } from '@pulseboard/shared/schemas';
import { FlaskConical, Lightbulb, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorMessage } from '../../api/http.js';
import { useTestMonitorConfig } from '../../api/monitors.js';
import { formatDuration } from '../../lib/format.js';
import Button from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import Field, { inputClasses } from '../ui/Field.jsx';
import CostEstimate from './CostEstimate.jsx';
import TestResult from './TestResult.jsx';

const INTERVAL_PRESETS = [10, 30, 60, 120, 300, 600, 1800, 3600];

/** The form edits headers as a list of rows; the API wants an object. */
function toPayload(values) {
  const headers = Object.fromEntries(
    (values.headers ?? [])
      .filter((row) => row.name.trim())
      .map((row) => [row.name.trim(), row.value]),
  );
  return { ...values, headers };
}

function toFormValues(monitor) {
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
  } = useForm({ resolver: zodResolver(schema), defaultValues: toFormValues(monitor) });
  const headerRows = useFieldArray({ control, name: 'headers' });
  const [method, keyword, intervalSec, costPer1kRequests, currency] = useWatch({
    control,
    name: ['method', 'keyword', 'intervalSec', 'costPer1kRequests', 'currency'],
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
          <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600 sm:col-span-2 dark:bg-slate-800/60 dark:text-slate-300">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-100">Tip:</span> point
              PulseBoard at a lightweight <code className="text-xs">/health</code> endpoint that
              doesn&apos;t touch your database or paid services. Every check is a real request to
              your server;{' '}
              <Link
                to="/bot"
                target="_blank"
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
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
          <div className="sm:col-span-2">
            <CostEstimate
              intervalSec={intervalSec}
              costPer1kRequests={costPer1kRequests}
              currency={currency}
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
            <p className="text-sm text-slate-500">No custom headers.</p>
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
            <p className="text-xs text-red-600 dark:text-red-400">{errors.headers.message}</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Cost"
          description="Optional. If your endpoint is billed per request, enter your price to see what monitoring costs you."
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
        </div>
      </Card>

      {errors.root?.message && <p className="text-sm text-red-600">{errors.root.message}</p>}

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
