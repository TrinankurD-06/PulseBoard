import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { monitorKeys, useCreateMonitor, useMonitor } from '../../api/monitors.js';
import { AGENT_TYPE } from '../../lib/agent.js';
import { cn } from '../../lib/cn.js';
import Button, { primaryButtonClasses } from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import AgentForm from './AgentForm.jsx';
import { AgentSnippets, KeyReveal } from './AgentSetup.jsx';

const STEPS = ['Configure', 'Install & key', 'Connect'];

function Stepper({ step }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm" aria-label="Setup steps">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-pill border font-mono text-[11px]',
                current && 'border-brand bg-brand text-brand-ink',
                done && 'border-line-strong text-brand',
                !current && !done && 'border-line text-faint',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={cn(current ? 'text-fg' : 'text-faint')}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-line-strong" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Step 3: flips from "Waiting…" to "Connected" when lastReportAt arrives live (check:result). */
function WaitForReport({ wid, monitorId }) {
  const { data: monitor } = useMonitor(wid, monitorId);
  const connected = Boolean(monitor?.lastReportAt);
  const detailPath = `/app/${wid}/monitors/${monitorId}`;

  return (
    <Card>
      <CardHeader title="Connect" description="Start (or redeploy) your app with the agent." />
      <div className="space-y-4 p-5">
        <p
          role="status"
          className={cn('flex items-center gap-2', connected ? 'text-status-up' : 'text-muted')}
        >
          {connected ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {connected ? 'Connected: first report received' : 'Waiting for the first report…'}
        </p>
        <p className="text-sm text-muted">
          {connected
            ? 'Your app is reporting. Charts fill in with every report.'
            : `The first report arrives one interval after your app starts, even with no traffic. This page updates by itself.`}
        </p>
        <div className="flex justify-end">
          <Link
            to={detailPath}
            className={cn(
              'inline-flex h-10 items-center rounded-pill px-5 text-sm font-medium transition-colors duration-200 ease-(--ease)',
              connected
                ? primaryButtonClasses
                : 'border border-line-strong text-fg hover:border-fg hover:bg-surface-2',
            )}
          >
            {connected ? 'Go to monitor' : 'Skip to the monitor'}
          </Link>
        </div>
      </div>
    </Card>
  );
}

/**
 * New agent monitor in three steps: (1) configure, (2) install + the key,
 * shown once, (3) wait live for the first report.
 */
export default function AgentWizard({ wid, onCancel }) {
  const queryClient = useQueryClient();
  const createMonitor = useCreateMonitor(wid);
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState(null); // { monitor, agentKey }

  // The key exists only in this page's memory: warn before losing it.
  const keyUnsaved = step === 1;
  useEffect(() => {
    if (!keyUnsaved) return undefined;
    const warn = (event) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [keyUnsaved]);

  async function onSubmit(values) {
    try {
      const { agentKey, ...monitor } = await createMonitor.mutateAsync({
        ...values,
        type: AGENT_TYPE,
      });
      // Keep the key out of the query cache: only this page shows it, once.
      queryClient.setQueryData(monitorKeys.detail(wid, monitor.id), monitor);
      setCreated({ monitor, agentKey });
      setStep(1);
      toast.success(`Monitor "${monitor.name}" created`);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  return (
    <div>
      <Stepper step={step} />
      {step === 0 && (
        <AgentForm submitLabel="Create & get key" onSubmit={onSubmit} onCancel={onCancel} />
      )}
      {step === 1 && created && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your agent key" description={created.monitor.name} />
            <div className="p-5">
              {created.agentKey ? (
                <KeyReveal agentKey={created.agentKey} />
              ) : (
                <p className="text-sm text-muted">
                  The server didn&apos;t return a key. Regenerate one from the monitor page.
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Install the agent" />
            <div className="space-y-5 p-5">
              <AgentSnippets
                reportEverySec={created.monitor.reportEverySec}
                agentKey={created.agentKey}
              />
              <div className="flex justify-end">
                <Button onClick={() => setStep(2)}>I&apos;ve saved my key</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
      {step === 2 && created && <WaitForReport wid={wid} monitorId={created.monitor.id} />}
    </div>
  );
}
