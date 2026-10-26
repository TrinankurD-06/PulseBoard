// Status colours + a text label for every uptime level (colour is never the
// only cue). Thresholds live in shared `uptimeLevel()`.
export const UPTIME_LEVELS = {
  good: { label: 'Operational', bar: 'bg-status-up' },
  degraded: { label: 'Degraded', bar: 'bg-status-pending' },
  bad: { label: 'Major outage', bar: 'bg-status-down' },
  none: { label: 'No data', bar: 'bg-status-none' },
};
