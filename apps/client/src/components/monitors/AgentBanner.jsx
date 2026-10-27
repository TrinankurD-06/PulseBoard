import { AlertTriangle, Radar, WifiOff } from 'lucide-react';
import { agentState } from '../../lib/agent.js';
import { cn } from '../../lib/cn.js';

const BANNERS = {
  degraded: {
    tone: 'amber',
    Icon: AlertTriangle,
    title: 'Degraded: the agent stopped reporting, but your app still answers',
    text: 'Probably the agent (or its key) rather than the app: check the app logs for "[pulseboard-agent]" warnings. No incident is opened; probes repeat every 5 minutes.',
  },
  probing: {
    tone: 'amber',
    Icon: Radar,
    title: 'No reports: probing your app',
    text: 'Up to 3 probes, 10 seconds apart. If all fail, an incident opens.',
  },
  silent: {
    tone: 'red',
    Icon: WifiOff,
    title: 'The agent is silent',
    text: 'No reports are arriving. The incident resolves after 2 good reports.',
  },
};

/** Live banner for the states that need attention (text first, colour reinforces). */
export default function AgentBanner({ monitor, now }) {
  const { state, text } = agentState(monitor, now);
  const banner = BANNERS[state];
  if (!banner) return null;
  const { tone, Icon, title } = banner;

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-card border bg-transparent px-5 py-4',
        tone === 'red' ? 'border-status-down/40' : 'border-status-degraded/40',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'red' ? 'text-status-down' : 'text-status-degraded',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-fg">{title}</p>
        <p className="mt-1 text-sm text-muted">{text}</p>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">{banner.text}</p>
      </div>
    </div>
  );
}
