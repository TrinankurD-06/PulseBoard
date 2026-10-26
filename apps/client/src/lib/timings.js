// Network phases of a check, in the order they happen. Colours are CSS tokens
// (see index.css) so light and dark mode each get their validated steps. They
// are categorical slots 1-5, deliberately distinct from the status colours.
export const TIMING_PHASES = [
  { key: 'dnsMs', label: 'DNS', color: 'var(--color-timing-dns)' },
  { key: 'tcpMs', label: 'TCP', color: 'var(--color-timing-tcp)' },
  { key: 'tlsMs', label: 'TLS', color: 'var(--color-timing-tls)' },
  { key: 'ttfbMs', label: 'TTFB', color: 'var(--color-timing-ttfb)' },
  { key: 'downloadMs', label: 'Download', color: 'var(--color-timing-download)' },
];
