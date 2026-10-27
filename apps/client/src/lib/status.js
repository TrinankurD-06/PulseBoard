// One place that maps monitor status to label and colours, so dots, badges,
// bars and banners always agree (green up, red down, amber pending/degraded,
// grey paused). The label always accompanies the colour.
export const STATUS_STYLES = {
  up: {
    label: 'Up',
    dot: 'bg-status-up',
    text: 'text-status-up',
    tone: 'green',
  },
  down: {
    label: 'Down',
    dot: 'bg-status-down',
    text: 'text-status-down',
    tone: 'red',
  },
  pending: {
    label: 'Pending',
    dot: 'bg-status-pending',
    text: 'text-status-degraded',
    tone: 'amber',
  },
  // Agent monitors: the agent stopped reporting but the app still answers.
  degraded: {
    label: 'Degraded',
    dot: 'bg-status-degraded',
    text: 'text-status-degraded',
    tone: 'amber',
  },
  paused: {
    label: 'Paused',
    dot: 'bg-status-paused',
    text: 'text-muted',
    tone: 'neutral',
  },
};

export const statusStyle = (status) => STATUS_STYLES[status] ?? STATUS_STYLES.pending;

// Reachable from the outside: degraded (agent silent, app answers) counts as up
// in summaries, like on public status pages.
export const isOperational = (status) => status === 'up' || status === 'degraded';
