import { AlertTriangle, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useRegenerateAgentKey } from '../../api/monitors.js';
import { agentEndpoint, agentSnippets, KEY_ENV_VAR, maskedKey } from '../../lib/agent.js';
import Button from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import CodeBlock, { CopyButton } from '../ui/CodeBlock.jsx';
import Modal from '../ui/Modal.jsx';

/**
 * The agent key, shown exactly once (the server only keeps its hash). The
 * customer confirms they saved it before moving on.
 */
export function KeyReveal({ agentKey, onAcknowledge, acknowledgeLabel = "I've saved my key" }) {
  return (
    <div className="space-y-3">
      <div
        role="alert"
        className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
      >
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <p>
          <span className="font-medium">Copy this key now: it won&apos;t be shown again.</span>{' '}
          Store it as a secret (e.g. <code>{KEY_ENV_VAR}</code>), never in your source code. Lost
          it? Regenerate a new one from the monitor page.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <code
          className="min-w-0 flex-1 rounded-md bg-slate-100 px-3 py-2 text-sm break-all dark:bg-slate-800"
          aria-label="Agent key"
        >
          {agentKey}
        </code>
        <CopyButton text={agentKey} label="Copy agent key" />
      </div>
      {onAcknowledge && (
        <div className="flex justify-end">
          <Button onClick={onAcknowledge}>{acknowledgeLabel}</Button>
        </div>
      )}
    </div>
  );
}

/** Install command, env line and Express snippet. */
export function AgentSnippets({ reportEverySec, agentKey }) {
  const snippets = agentSnippets({ endpoint: agentEndpoint(), reportEverySec, agentKey });
  return (
    <ol className="space-y-4 text-sm">
      <li>
        <p className="mb-2 font-medium">1. Install the package (Node.js 18+, Express)</p>
        <CodeBlock code={snippets.install} label="install command" />
      </li>
      <li>
        <p className="mb-2 font-medium">2. Put the key in your app&apos;s environment</p>
        <CodeBlock code={snippets.env} label="environment variable" />
      </li>
      <li>
        <p className="mb-2 font-medium">3. Add the middleware before your routes</p>
        <CodeBlock code={snippets.code} label="Express setup" />
        <p className="mt-2 text-xs text-slate-500">
          Only aggregated counts, latency percentiles and route patterns (like /orders/:id) are
          sent: never URLs, ids, query strings, headers or bodies.
        </p>
      </li>
    </ol>
  );
}

function RegenerateKey({ wid, monitor }) {
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const regenerate = useRegenerateAgentKey(wid, monitor.id);

  async function confirm() {
    try {
      const { agentKey } = await regenerate.mutateAsync();
      setNewKey(agentKey);
      toast.success('New agent key created. The old key no longer works.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function close() {
    setOpen(false);
    setNewKey(null);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" /> Regenerate key
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={newKey ? 'Your new agent key' : 'Regenerate agent key?'}
      >
        {newKey ? (
          <KeyReveal agentKey={newKey} onAcknowledge={close} />
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              The current key stops working <strong>immediately</strong>. Reports sent with it are
              rejected until your app is restarted with the new key, so the monitor will go silent
              and may open an incident.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" loading={regenerate.isPending} onClick={confirm}>
                Regenerate key
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/**
 * Detail-page card: the key prefix (the key itself is never shown again),
 * setup snippets and key regeneration. Viewers see only the prefix.
 */
export default function AgentSetup({ wid, monitor, canEdit }) {
  return (
    <Card>
      <CardHeader
        title="Agent setup"
        description="Your app reports with this key. It's secret: anyone with it can send reports."
        action={canEdit && <RegenerateKey wid={wid} monitor={monitor} />}
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <code className="min-w-0 flex-1 rounded-md bg-slate-100 px-3 py-2 text-sm break-all dark:bg-slate-800">
            {maskedKey(monitor.agentKeyPrefix)}
          </code>
        </div>
        {canEdit ? (
          <AgentSnippets reportEverySec={monitor.reportEverySec} />
        ) : (
          <p className="text-sm text-slate-500">
            Only workspace members and owners can see the setup snippets and regenerate the key.
          </p>
        )}
      </div>
    </Card>
  );
}
