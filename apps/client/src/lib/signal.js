// Pure mapping from monitor data to the signal field's inputs. Every scale is
// documented here so the picture can be read: calm and quick = low gentle
// waves, slow responses = tall waves, a down monitor = a turbulent red patch.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Amplitude scale (0..1): logarithmic in response time, since 150 ms vs 300 ms
// matters as much as 1.5 s vs 3 s.
//   <= 150 ms -> 0.10 (a calm, low swell, never flat)
//      400 ms -> 0.37
//     1000 ms -> 0.62
//   >= 4000 ms -> 1.00 (tall waves)
export const CALM_MS = 150;
export const SLOW_MS = 4000;
export const AMPLITUDE_FLOOR = 0.1;
export const IDLE_AMPLITUDE = 0.25; // no data yet

export function amplitudeFromLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return AMPLITUDE_FLOOR;
  const t = Math.log(ms / CALM_MS) / Math.log(SLOW_MS / CALM_MS);
  return AMPLITUDE_FLOOR + (1 - AMPLITUDE_FLOOR) * clamp(t, 0, 1);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Amplitude from sparklines ({ [monitorId]: [{ t, ms, ok }] }). Each monitor
 * is summarised by the median of its successful checks (one slow outlier does
 * not move it); the field blends the mean of those (60 %) with the slowest
 * monitor (40 %), so one struggling service still shows. Failed checks carry
 * no latency and are skipped: a failure is shown as a down region instead.
 */
export function amplitudeFromSparklines(sparklines) {
  const medians = [];
  for (const points of Object.values(sparklines ?? {})) {
    const values = (points ?? [])
      .filter((p) => p?.ok !== false && Number.isFinite(p?.ms))
      .map((p) => p.ms);
    if (values.length) medians.push(median(values));
  }
  if (!medians.length) return IDLE_AMPLITUDE;
  const mean = medians.reduce((a, b) => a + b, 0) / medians.length;
  return amplitudeFromLatency(0.6 * mean + 0.4 * Math.max(...medians));
}

// Speed scale (0..1): logarithmic in the check interval. The geometric mean of
// the active monitors' intervals is used.
//   <= 30 s -> 1.00 (brisk flow)
//      5 min -> 0.59
//   >= 1 h -> 0.15 (a slow drift, never still)
export const FAST_INTERVAL_SEC = 30;
export const SLOW_INTERVAL_SEC = 3600;
export const SPEED_FLOOR = 0.15;
export const IDLE_SPEED = 0.35; // no data yet

export function speedFromInterval(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return IDLE_SPEED;
  const t = Math.log(sec / FAST_INTERVAL_SEC) / Math.log(SLOW_INTERVAL_SEC / FAST_INTERVAL_SEC);
  return 1 - (1 - SPEED_FLOOR) * clamp(t, 0, 1);
}

/** Speed from monitors ({ intervalSec, status }): paused monitors do not count. */
export function speedFromMonitors(monitors) {
  const intervals = (monitors ?? [])
    .filter((m) => m && m.status !== 'paused' && Number(m.intervalSec) > 0)
    .map((m) => Number(m.intervalSec));
  if (!intervals.length) return IDLE_SPEED;
  const geo = Math.exp(intervals.reduce((a, v) => a + Math.log(v), 0) / intervals.length);
  return speedFromInterval(geo);
}

/**
 * One slot per monitor along the x axis, in list order. A monitor is a `down`
 * region only while its status is 'down'; everything else (up, pending,
 * degraded, paused) is calm.
 */
export function regionsFromMonitors(monitors) {
  const list = monitors ?? [];
  const n = list.length;
  return list.map((m, i) => ({
    x0: i / n,
    x1: (i + 1) / n,
    state: m?.status === 'down' ? 'down' : 'ok',
  }));
}

/** Centre of a monitor's slot (0..1), or null when the monitor is not in the list. */
export function slotCenter(monitors, monitorId) {
  const list = monitors ?? [];
  const i = list.findIndex((m) => m?.id === monitorId);
  return i < 0 ? null : (i + 0.5) / list.length;
}

/**
 * Ripple strength (0..1) for one live check: a failed check is a full-strength
 * ripple, a successful one 0.3 up to 0.7 with its latency.
 */
export function pulseStrength({ ok, ms } = {}) {
  if (ok === false) return 1;
  return 0.3 + 0.4 * ((amplitudeFromLatency(ms) - AMPLITUDE_FLOOR) / (1 - AMPLITUDE_FLOOR));
}

export const countDown = (regions) => (regions ?? []).filter((r) => r.state === 'down').length;

/** The field's screen reader label. */
export function signalLabel(regions) {
  const down = countDown(regions);
  if (!down) return 'Live signal: all monitors calm';
  return `Live signal: ${down} ${down === 1 ? 'monitor' : 'monitors'} down`;
}

/**
 * Public status page: status only, no latency. Calm and slow while all is
 * well; taller and quicker while something is down.
 */
export function statusSignal(monitors) {
  const regions = regionsFromMonitors(monitors);
  const anyDown = countDown(regions) > 0;
  return { amplitude: anyDown ? 0.5 : 0.22, speed: anyDown ? 0.5 : 0.3, regions };
}

/**
 * Landing page: gentle synthetic motion. A slow drift of amplitude (0.22 to
 * 0.46) and speed (0.28 to 0.50) over a few minutes. `t` is in seconds.
 */
export function demoSignalAt(t) {
  return {
    amplitude: 0.34 + 0.12 * Math.sin(t * 0.11) + 0.04 * Math.sin(t * 0.29 + 1),
    speed: 0.39 + 0.09 * Math.sin(t * 0.07 + 2) + 0.02 * Math.sin(t * 0.23),
  };
}
