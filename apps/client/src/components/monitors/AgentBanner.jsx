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
        'flex items-start gap-3 rounded-xl border px-4 py-3',
        tone === 'red'
          ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100'
          : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-5 w-5 shrink-0',
          tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm opacity-90">{text}</p>
        <p className="mt-1 text-sm opacity-90">{banner.text}</p>
      </div>
    </div>
  );
}
