import { zodResolver } from '@hookform/resolvers/zod';
import { statusPageSchema } from '@pulseboard/shared/schemas';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { hostOf } from '../../lib/format.js';
import StatusDot from '../monitors/StatusDot.jsx';
import Button from '../ui/Button.jsx';
import Field from '../ui/Field.jsx';
import Switch from '../ui/Switch.jsx';

/** "Acme Inc. Status" -> "acme-inc-status" (same rules as the API's slug check). */
const slugify = (text) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * Create/edit a status page. The slug follows the title until the user edits
 * it by hand. `onSubmit` may throw an axios error whose field details (e.g. a
 * taken slug) are shown on the matching input.
 */
export default function StatusPageForm({ page, monitors, wid, submitLabel, onSubmit, onCancel }) {
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(statusPageSchema),
    defaultValues: {
      title: page?.title ?? '',
      slug: page?.slug ?? '',
      description: page?.description ?? '',
      isPublic: page?.isPublic ?? true,
      monitorIds: page?.monitorIds ?? [],
    },
  });

  const titleField = register('title', {
    onChange: (event) => {
      if (!slugTouched) setValue('slug', slugify(event.target.value), { shouldValidate: false });
    },
  });
  const slugField = register('slug', { onChange: () => setSlugTouched(true) });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      for (const { path, message } of error?.response?.data?.error?.details ?? []) {
        setError(path || 'root', { message });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Title"
        placeholder="Acme Status"
        error={errors.title?.message}
        {...titleField}
      />
      <Field
        label="Address"
        hint={`${window.location.origin}/status/…`}
        placeholder="acme"
        error={errors.slug?.message}
        {...slugField}
      />
      <Field
        label="Description (optional)"
        as="textarea"
        rows={2}
        placeholder="Live status of our public services"
        error={errors.description?.message}
        {...register('description')}
      />

      <Controller
        control={control}
        name="isPublic"
        render={({ field }) => (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium">Public</p>
              <p className="text-xs text-slate-500">
                Anyone with the link can view it, no login needed.
              </p>
            </div>
            <Switch checked={field.value} onChange={field.onChange} label="Public page" />
          </div>
        )}
      />

      <Controller
        control={control}
        name="monitorIds"
        render={({ field }) => (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Monitors shown on the page</legend>
            {monitors.length === 0 ? (
              <p className="text-sm text-slate-500">
                No monitors yet.{' '}
                <Link to={`/app/${wid}/monitors/new`} className="text-emerald-600 hover:underline">
                  Create one first
                </Link>
                .
              </p>
            ) : (
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {monitors.map((monitor) => {
                  const checked = field.value.includes(monitor.id);
                  return (
                    <li key={monitor.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            field.onChange(
                              checked
                                ? field.value.filter((id) => id !== monitor.id)
                                : [...field.value, monitor.id],
                            )
                          }
                          className="h-4 w-4 accent-emerald-600"
                        />
                        <StatusDot status={monitor.status} />
                        <span className="min-w-0 flex-1 truncate text-sm">{monitor.name}</span>
                        <span className="truncate text-xs text-slate-500">
                          {hostOf(monitor.url)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {errors.monitorIds && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                {errors.monitorIds.message ?? 'Check the selected monitors'}
              </p>
            )}
          </fieldset>
        )}
      />

      {errors.root?.message && <p className="text-sm text-red-600">{errors.root.message}</p>}

      <div className="flex justify-end gap-2 pt-2">
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
