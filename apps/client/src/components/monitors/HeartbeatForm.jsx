import { zodResolver } from '@hookform/resolvers/zod';
import { Calculator } from 'lucide-react';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { formatDuration } from '../../lib/format.js';
import {
  buildHeartbeatSchema,
  DEFAULT_GRACE_SEC,
  expectedEveryOptions,
  graceOptions,
} from '../../lib/heartbeat.js';
import Button from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import Field from '../ui/Field.jsx';

function toFormValues(monitor) {
  return {
    name: monitor?.name ?? '',
    expectedEverySec: String(monitor?.expectedEverySec ?? 3600),
    graceSec: String(monitor?.graceSec ?? DEFAULT_GRACE_SEC),
  };
}

/**
 * Create/edit form for a heartbeat monitor: the customer's job pings us, so
 * all we need is how often to expect a ping and how late it may be.
 * `onSubmit(values)` may throw an axios error; its field details are shown.
 */
export default function HeartbeatForm({
  monitor,
  minIntervalSec,
  submitLabel,
  onSubmit,
  onCancel,
}) {
  const schema = useMemo(() => buildHeartbeatSchema(minIntervalSec), [minIntervalSec]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toFormValues(monitor) });
  const [expectedEverySec, graceSec] = useWatch({
    control,
    name: ['expectedEverySec', 'graceSec'],
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

  const expectedOptions = expectedEveryOptions(minIntervalSec, monitor?.expectedEverySec);
  const graceChoices = graceOptions(monitor?.graceSec);
  const alertAfter = Number(expectedEverySec) + Number(graceSec);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader
          title="Heartbeat"
          description="Your job calls a secret URL each time it runs. If a ping is late, you're alerted."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Name"
            className="sm:col-span-2"
            placeholder="Nightly backup"
            error={errors.name?.message}
            {...register('name')}
          />
          <Field
            label="Expect a ping every"
            as="select"
            error={errors.expectedEverySec?.message}
            {...register('expectedEverySec')}
          >
            {expectedOptions.map((sec) => (
              <option key={sec} value={sec}>
                {formatDuration(sec)}
              </option>
            ))}
          </Field>
          <Field
            label="Grace period"
            as="select"
            hint="Extra time before a late ping counts as missed"
            error={errors.graceSec?.message}
            {...register('graceSec')}
          >
            {graceChoices.map((sec) => (
              <option key={sec} value={sec}>
                {sec === 0 ? 'None' : formatDuration(sec)}
              </option>
            ))}
          </Field>
          <div className="flex items-start gap-2 rounded-card border border-line px-4 py-3 text-sm text-muted sm:col-span-2">
            <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
            <p>
              <span className="text-fg">0 requests/month to your servers</span>
              {Number.isFinite(alertAfter) && alertAfter > 0 && (
                <> · alert if no ping arrives within {formatDuration(alertAfter)}</>
              )}
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
