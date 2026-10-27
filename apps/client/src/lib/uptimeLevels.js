// Status colours + a text label for every uptime level (colour is never the
// only cue). Thresholds live in shared `uptimeLevel()`. `none` is the hairline.
export const UPTIME_LEVELS = {
  good: { label: 'Operational', bar: 'bg-status-up' },
  degraded: { label: 'Degraded', bar: 'bg-status-degraded' },
  bad: { label: 'Outage', bar: 'bg-status-down' },
  none: { label: 'No data', bar: 'bg-line' },
};
