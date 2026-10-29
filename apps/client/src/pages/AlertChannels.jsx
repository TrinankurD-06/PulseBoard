import { zodResolver } from '@hookform/resolvers/zod';
import { ROLES } from '@pulseboard/shared/constants';
import { alertChannelSchema } from '@pulseboard/shared/schemas';
import { Hash, Mail, MessageSquare, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  useAlertChannels,
  useCreateAlertChannel,
  useDeleteAlertChannel,
  useTestAlertChannel,
  useUpdateAlertChannel,
} from '../api/alertChannels.js';
import { errorMessage } from '../api/http.js';
import PageHeader from '../components/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Field from '../components/ui/Field.jsx';
import RingDotCta from '../components/ui/RingDotCta.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import Switch from '../components/ui/Switch.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';

const TYPES = {
  discord: {
    label: 'Discord',
    icon: MessageSquare,
    placeholder: 'https://discord.com/api/webhooks/…',
    hint: 'Discord: Server settings → Integrations → Webhooks → New webhook → Copy URL',
  },
  slack: {
    label: 'Slack',
    icon: Hash,
    placeholder: 'https://hooks.slack.com/services/…',
    hint: 'Slack: create an app with "Incoming Webhooks" enabled and copy the webhook URL',
  },
  email: {
    label: 'Email',
    icon: Mail,
    placeholder: 'oncall@company.com',
    hint: 'Email (Resend). Without a Resend API key, emails go to a test inbox; the preview link appears in the timeline.',
  },
};

function AddChannelForm({ wid }) {
  const createChannel = useCreateAlertChannel(wid);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(alertChannelSchema),
    defaultValues: { type: 'discord', name: '', target: '', isEnabled: true },
  });
  const type = TYPES[useWatch({ control, name: 'type' })];

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createChannel.mutateAsync(values);
      toast.success(`${TYPES[values.type].label} channel added`);
      reset({ type: values.type, name: '', target: '', isEnabled: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Card>
      <CardHeader
        title="Add a channel"
        description="Alerts go to every enabled channel when a monitor goes down and when it recovers."
      />
      <form onSubmit={onSubmit} noValidate className="grid gap-4 p-5 sm:grid-cols-[10rem_1fr]">
        <Field label="Type" as="select" {...register('type')}>
          {Object.entries(TYPES).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Field>
        <Field label="Name (optional)" placeholder="#on-call" {...register('name')} />
        <Field
          label={type.label === 'Email' ? 'Email address' : 'Webhook URL'}
          className="sm:col-span-2"
          placeholder={type.placeholder}
          hint={type.hint}
          error={errors.target?.message}
          {...register('target')}
        />
        <div className="sm:col-span-2">
          <Button type="submit" loading={createChannel.isPending}>
            <Plus className="h-4 w-4" /> Add channel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ChannelRow({ channel, wid, canEdit }) {
  const updateChannel = useUpdateAlertChannel(wid);
  const deleteChannel = useDeleteAlertChannel(wid);
  const testChannel = useTestAlertChannel(wid);
  const { label, icon: Icon } = TYPES[channel.type];

  async function onToggle(isEnabled) {
    try {
      await updateChannel.mutateAsync({ id: channel.id, isEnabled });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  // The outcome of the last test stays on the row until the next one: a toast alone
  // appears at the window's bottom edge and is gone in seconds, easy to miss.
  const [testResult, setTestResult] = useState(null);

  async function onTest() {
    setTestResult(null);
    try {
      const result = await testChannel.mutateAsync(channel.id);
      setTestResult({
        ok: true,
        message: `Test alert sent to ${channel.target}.`,
        previewUrl: result.previewUrl,
      });
      toast.success('Test alert sent', {
        description: result.previewUrl ? `Preview: ${result.previewUrl}` : undefined,
        action: result.previewUrl
          ? { label: 'Open', onClick: () => window.open(result.previewUrl, '_blank') }
          : undefined,
      });
    } catch (error) {
      setTestResult({ ok: false, message: errorMessage(error) });
      toast.error(errorMessage(error), { duration: 12_000 });
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete the ${label} channel "${channel.name || channel.target}"?`)) return;
    try {
      await deleteChannel.mutateAsync(channel.id);
      toast.success('Channel deleted');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors duration-200 hover:bg-surface">
      <div className="rounded-pill border border-line p-2.5">
        <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">
          {channel.name || label} {channel.name && <span className="text-faint">· {label}</span>}
        </p>
        <p className="truncate font-mono text-[11px] text-faint">{channel.target}</p>
      </div>
      <Switch
        checked={channel.isEnabled}
        onChange={onToggle}
        disabled={!canEdit || updateChannel.isPending}
        label={`${channel.isEnabled ? 'Disable' : 'Enable'} ${channel.name || label}`}
      />
      {canEdit && (
        <>
          <Button variant="secondary" size="sm" loading={testChannel.isPending} onClick={onTest}>
            {!testChannel.isPending && <Send className="h-4 w-4" />} Test
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={deleteChannel.isPending}
            onClick={onDelete}
            aria-label={`Delete ${channel.name || label}`}
          >
            {!deleteChannel.isPending && <Trash2 className="h-4 w-4" />}
          </Button>
        </>
      )}
      {testResult && (
        <p
          role="status"
          className="flex basis-full items-start gap-2 pl-[3.25rem] text-[13px] leading-relaxed break-words text-muted"
        >
          <span
            aria-hidden="true"
            className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-pill ${testResult.ok ? 'bg-status-up' : 'bg-status-down'}`}
          />
          <span>
            <span className="text-fg">{testResult.ok ? 'Sent.' : 'Failed.'}</span>{' '}
            {testResult.message}
            {testResult.previewUrl && (
              <>
                {' '}
                <a
                  href={testResult.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg underline underline-offset-4"
                >
                  Open the test inbox
                </a>
              </>
            )}
          </span>
        </p>
      )}
    </li>
  );
}

export default function AlertChannels() {
  const { wid, can } = useCurrentWorkspace();
  const { data: channels, isPending, isError } = useAlertChannels(wid);
  const canEdit = can(ROLES.MEMBER);

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Alert channels."
        phrase="Where PulseBoard sends down and recovery alerts."
      />

      {canEdit && <AddChannelForm wid={wid} />}

      {isError && <p className="text-sm text-status-down">Couldn&apos;t load alert channels.</p>}
      {isPending && <Skeleton className="h-32 rounded-card" />}

      {channels?.length === 0 && (
        <EmptyState
          title="No alert channels"
          description="Without a channel, incidents are still recorded but nobody is notified."
          action={
            canEdit && (
              <RingDotCta onClick={() => document.querySelector('select[name="type"]')?.focus()}>
                Add a channel
              </RingDotCta>
            )
          }
        />
      )}

      {channels?.length > 0 && (
        <Card>
          <CardHeader title="Channels" />
          <ul className="divide-y divide-line">
            {channels.map((channel) => (
              <ChannelRow key={channel.id} channel={channel} wid={wid} canEdit={canEdit} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
