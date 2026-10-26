const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** "5 seconds ago", "2 hours ago". Never in the future. */
export function timeAgo(date, now = Date.now()) {
  if (!date) return 'never';
  const seconds = Math.round((new Date(date).getTime() - now) / 1000);
  // Future times happen when a live update is newer than the last "now" tick,
  // or the server clock is slightly ahead: treat them as just now.
  if (seconds > -5) return 'just now';
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return relativeTime.format(Math.round(seconds / size), unit);
    }
  }
  return '';
}

/** 30 -> "30s", 60 -> "1m", 5400 -> "1h 30m". */
export function formatDuration(totalSeconds) {
  if (totalSeconds == null) return '—';
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  return [
    days && `${days}d`,
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    !days && !hours && seconds && `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function formatMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** "https://api.example.com/health" -> "api.example.com". */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
