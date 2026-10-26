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

/** Compact form for tight spaces: "just now", "34s ago", "5m ago", "2h ago", "3d ago". */
export function timeAgoShort(date, now = Date.now()) {
  if (!date) return 'never';
  const seconds = Math.round((now - new Date(date).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  for (const [unit, size] of [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ]) {
    if (seconds >= size) return '' + Math.floor(seconds / size) + unit + ' ago';
  }
  return 'just now';
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

/**
 * Money in the monitor's currency: 432 INR -> "₹432", 0.62 INR -> "₹0.62".
 * Indian grouping for INR (₹1,00,000), the default locale's otherwise.
 */
export function formatCurrency(amount, currency = 'INR') {
  if (amount == null) return '—';
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** 43200 -> "43,200": request counts. */
export function formatCount(count) {
  if (count == null) return '—';
  return Math.round(count).toLocaleString('en-US');
}

/** "2026-10" -> "October 2026". */
export function formatMonth(month) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "https://api.example.com/health" -> "api.example.com". */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
