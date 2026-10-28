import { formatUptime } from '@pulseboard/shared/uptime';
// Status colours + a text label for every uptime level (colour is never the
// only cue). Thresholds live in shared `uptimeLevel()`. `none` is the hairline.
export const UPTIME_LEVELS = {
  good: { label: 'Operational', bar: 'bg-status-up' },
  degraded: { label: 'Degraded', bar: 'bg-status-degraded' },
  bad: { label: 'Outage', bar: 'bg-status-down' },
  none: { label: 'No data', bar: 'bg-line' },
};

/**
 * Value and decimals for an uptime TickGauge, so it prints what formatUptime
 * prints: cut to 2 decimals, "100" only when nothing was down. (Rounding to one
 * decimal is what once showed 99.96 as 100.0.)
 */
export function uptimeGaugeProps(uptime) {
  if (uptime == null) return { value: null, decimals: 2 };
  if (uptime >= 100) return { value: 100, decimals: 0 };
  return { value: Number(formatUptime(uptime)), decimals: 2 };
}
