// Network phases of a check, in the order they happen. Colours are shared by
// the "Test now" bar and the timing chart on the monitor page. They're
// deliberately not green/red/amber, which mean up/down/pending in this app.
export const TIMING_PHASES = [
  { key: 'dnsMs', label: 'DNS', color: '#38bdf8' },
  { key: 'tcpMs', label: 'TCP', color: '#818cf8' },
  { key: 'tlsMs', label: 'TLS', color: '#c084fc' },
  { key: 'ttfbMs', label: 'TTFB', color: '#2dd4bf' },
  { key: 'downloadMs', label: 'Download', color: '#94a3b8' },
];
