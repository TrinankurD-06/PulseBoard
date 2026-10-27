import { KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useRegenerateHeartbeatToken } from '../../api/monitors.js';
import { cn } from '../../lib/cn.js';
import { heartbeatSnippets, pingUrl, SNIPPET_TABS } from '../../lib/heartbeat.js';
import Button from '../ui/Button.jsx';
import Card, { CardHeader } from '../ui/Card.jsx';
import CodeBlock, { CopyButton } from '../ui/CodeBlock.jsx';
import Modal from '../ui/Modal.jsx';

const MASK = '••••••';

const SNIPPET_HELP = {
  curl: 'Call this at the end of your job.',
  cron: 'Ping after the job succeeds (cron runs the curl only when the job exits with 0).',
  node: 'Ping from a Node script once the work is done.',
  startFail:
    'Optional: /start before the job measures its run time; /fail reports an error immediately (opens an incident at once).',
};

function RegenerateToken({ wid, monitor }) {
  const [open, setOpen] = useState(false);
  const regenerate = useRegenerateHeartbeatToken(wid, monitor.id);

  async function confirm() {
    try {
      await regenerate.mutateAsync();
      toast.success('New ping URL created. Update your jobs: the old URL no longer works.');
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" /> Regenerate
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Regenerate ping URL?">
        <p className="text-sm text-muted">
          The current URL stops working <strong className="font-normal text-fg">immediately</strong>
          . Every job that pings it must be updated with the new URL, or its pings will be rejected
          and the monitor will go down.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={regenerate.isPending} onClick={confirm}>
            Regenerate URL
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * Where the customer's job should send its pings: the secret URL and
 * copy-paste snippets. Viewers see the token masked and no snippets.
 */
export default function HeartbeatSetup({ wid, monitor, canEdit }) {
  const [tab, setTab] = useState('curl');
  const token = monitor.heartbeatToken;
  const visible = canEdit && token && token !== MASK;
  const url = visible ? pingUrl(token) : pingUrl(MASK);
  const snippets = visible ? heartbeatSnippets(url, monitor.expectedEverySec) : null;

  return (
    <Card>
      <CardHeader
        title="Ping URL"
        description="Call this URL from your job each time it runs. It's secret: anyone with it can send pings."
        action={visible && <RegenerateToken wid={wid} monitor={monitor} />}
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
          <code className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 font-mono text-xs break-all text-muted">
            {url}
          </code>
          {visible && <CopyButton text={url} label="Copy ping URL" />}
        </div>

        {!visible && (
          <p className="text-sm text-muted">
            Only workspace members and owners can see the ping URL and setup snippets.
          </p>
        )}

        {visible && (
          <div>
            <div
              role="tablist"
              aria-label="Setup snippets"
              className="mb-3 inline-flex flex-wrap rounded-pill border border-line p-0.5"
            >
              {SNIPPET_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'rounded-pill px-3 py-1 text-[13px] transition-colors duration-200',
                    tab === key ? 'bg-surface-2 text-fg' : 'text-faint hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-2 text-sm text-muted">{SNIPPET_HELP[tab]}</p>
            <CodeBlock code={snippets[tab]} label={SNIPPET_TABS.find((t) => t.key === tab).label} />
          </div>
        )}
      </div>
    </Card>
  );
}
