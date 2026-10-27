// Network phases of a check, in the order they happen: five tones stepping
// from --text down to --text-faint, so identity comes from the legend and the
// stacking order rather than from hue.
const tone = (share) => `color-mix(in oklab, var(--text) ${share}%, var(--bg))`;

export const TIMING_PHASES = [
  { key: 'dnsMs', label: 'DNS', color: 'var(--text)' },
  { key: 'tcpMs', label: 'TCP', color: tone(78) },
  { key: 'tlsMs', label: 'TLS', color: tone(60) },
  { key: 'ttfbMs', label: 'TTFB', color: tone(44) },
  { key: 'downloadMs', label: 'Download', color: 'var(--text-faint)' },
];
