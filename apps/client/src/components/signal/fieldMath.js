// Pure maths of the signal field. Both renderers (the WebGL shader, which is
// generated from these constants, and the 2D canvas fallback, which calls the
// functions below) use the same wave, ripple, projection and colour rules, so
// they draw the same picture. Nothing here touches the DOM.
//
// Coordinates: a point has a grid position gx (0 left .. 1 right) and gz
// (0 near the viewer .. 1 far). Screen space is normalised: sx 0..1 left to
// right, sy 0..1 top to bottom. The wave height and ripple are returned as a
// fraction of the banner height.

export const BINS = 64; // horizontal resolution of the per-region "down" level
export const MAX_POINTS = 20000;
export const SMALL_POINTS = 6000;
export const MAX_RIPPLES = 4;
export const STILL_PHASE = 1.7; // phase of the single frame under reduced motion

// Wave: three travelling sines plus a high-frequency turbulence term that only
// shows where a region is down. Output is about -1..1.
export const WAVE = {
  ax: 2.6, // x frequency, long swell
  az: 2.2, // z frequency
  ap: 1.0, // phase speed
  bx: 5.3,
  bz: 3.9,
  bp: -0.7,
  boff: 1.7,
  bw: 0.5,
  cx: -1.3,
  cz: 6.1,
  cp: 0.5,
  cw: 0.3,
  norm: 1.8,
  t1x: 17,
  t1z: 11,
  t1p: 3.1,
  t2x: 23,
  t2z: 7,
  t2p: -2.3,
  tw: 0.7, // turbulence weight
};

// Ripple: a Gaussian-windowed ring that expands from (x0, 0.5) and fades.
export const RIPPLE = {
  zScale: 2.2, // stretches z so the ring looks round under the perspective
  speed: 0.9, // radius growth, x units per second
  k: 14, // ring frequency
  w: 22, // Gaussian sharpness (1 / width squared)
  decay: 0.7, // amplitude decay per second
  life: 4, // seconds before a ripple is dropped
};

// Perspective and layout. Rows compress with distance (K), the field
// converges slightly toward the far edge, near points sit at the bottom.
export const VIEW = {
  k: 1.8,
  yNear: 0.76,
  yFar: 0.26,
  xsNear: 1.08,
  xsFar: 0.86,
  ampMin: 0.08, // wave height at amplitude 0, fraction of banner height
  ampRange: 0.2, // extra height at amplitude 1
  downBoost: 0.4, // down regions swell a little
  rippleGain: 0.1,
  liftScale: 0.1,
  alphaGain: 1.3,
  sizeFar: 1.1, // css px
  sizeNear: 2.3,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);
const hash01 = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

/**
 * How many points to draw. Desktop up to 20k; about 6k on narrow screens or
 * low-power devices (<= 4 cores); never more than one point per ~14 px of
 * banner area. `density` is 'auto', 'low', 'high' or an explicit count.
 */
export function selectPointBudget({ width = 0, height = 0, cores = 8, density = 'auto' } = {}) {
  if (typeof density === 'number' && Number.isFinite(density)) {
    return Math.round(clamp(density, 500, MAX_POINTS));
  }
  const small = width < 768 || cores <= 4;
  let budget = density === 'low' ? SMALL_POINTS : density === 'high' ? MAX_POINTS : null;
  if (budget == null) budget = small ? SMALL_POINTS : MAX_POINTS;
  if (width > 0 && height > 0) budget = Math.min(budget, Math.round((width * height) / 14));
  return Math.max(500, budget);
}

/** Columns x rows for a point budget and a banner aspect ratio (width / height). */
export function gridDims(count, aspect = 5) {
  const ratio = clamp(aspect * 0.8, 2, 6); // columns per row
  const rows = Math.max(8, Math.round(Math.sqrt(count / ratio)));
  const cols = Math.max(16, Math.floor(count / rows));
  return { cols, rows, count: cols * rows };
}

/**
 * The point grid as a flat Float32Array of [gx, gz, rnd] triplets. Points are
 * jittered slightly (deterministically) so the grid never forms moire lines.
 * rnd (0..1) varies each dot's size a little.
 */
export function generateGrid(cols, rows) {
  const out = new Float32Array(cols * rows * 3);
  let o = 0;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const n = j * cols + i;
      out[o] = clamp((i + 0.5 + (hash01(n) - 0.5) * 0.7) / cols, 0, 1);
      out[o + 1] = clamp((j + 0.5 + (hash01(n + 9.1) - 0.5) * 0.5) / rows, 0, 1);
      out[o + 2] = hash01(n + 31.7);
      o += 3;
    }
  }
  return out;
}

/** Wave height at x (-1..1), z (0..1) for a phase; turb (0..1) adds turbulence. */
export function waveHeight(x, z, phase, turb = 0) {
  const W = WAVE;
  const a = Math.sin(x * W.ax + z * W.az + phase * W.ap);
  const b = Math.sin(x * W.bx + z * W.bz + phase * W.bp + W.boff) * W.bw;
  const c = Math.sin(z * W.cz + phase * W.cp + x * W.cx) * W.cw;
  const t =
    Math.sin(x * W.t1x + z * W.t1z + phase * W.t1p) *
    Math.sin(x * W.t2x + z * W.t2z + phase * W.t2p) *
    turb *
    W.tw;
  return (a + b + c) / W.norm + t;
}

/**
 * Height contributed by one ripple: x0 (-1..1), age in seconds, strength 0..1.
 * A strength of 0 means an unused slot.
 */
export function rippleHeight(x, z, x0, age, strength) {
  if (!(strength > 0)) return 0;
  const R = RIPPLE;
  const d = Math.hypot(x - x0, (z - 0.5) * R.zScale);
  const u = d - age * R.speed;
  return strength * Math.sin(u * R.k) * Math.exp(-u * u * R.w) * Math.exp(-age * R.decay);
}

/** Sum of every active ripple in a packed [x0, age, strength] * MAX_RIPPLES array. */
export function totalRipple(x, z, ripples) {
  let sum = 0;
  for (let k = 0; k < MAX_RIPPLES; k += 1) {
    sum += rippleHeight(x, z, ripples[k * 3], ripples[k * 3 + 1], ripples[k * 3 + 2]);
  }
  return sum;
}

/**
 * Per-bin "down" targets (0..1) for a list of regions { x0, x1, state } with x
 * in 0..1. Edges are softened with two box blurs, so a region fades in and
 * out across a few bins instead of switching hard.
 */
export function regionBins(regions, n = BINS) {
  let cur = new Float32Array(n);
  for (const region of regions ?? []) {
    if (region?.state !== 'down') continue;
    for (let i = 0; i < n; i += 1) {
      const c = (i + 0.5) / n;
      if (c >= region.x0 && c <= region.x1) cur[i] = 1;
    }
    // A region narrower than one bin still marks the bin it falls in.
    const mid = clamp(Math.floor(((region.x0 + region.x1) / 2) * n), 0, n - 1);
    cur[mid] = 1;
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      next[i] = cur[i] * 0.5 + cur[Math.max(0, i - 1)] * 0.25 + cur[Math.min(n - 1, i + 1)] * 0.25;
    }
    cur = next;
  }
  return cur;
}

/** The down level at gx (0..1), linearly interpolated between bins. */
export function sampleBins(bins, gx) {
  const f = clamp(gx, 0, 1) * (bins.length - 1);
  const i = Math.floor(f);
  const t = f - i;
  return mix(bins[i], bins[Math.min(bins.length - 1, i + 1)], t);
}

/** Perspective factor: 1 near, shrinking with distance. */
export const perspective = (z) => 1 / (1 + VIEW.k * z);
/** Normalised depth 0 (near) .. 1 (far), the same curve the rows follow. */
export const depthP = (z) => (1 - perspective(z)) / (1 - 1 / (1 + VIEW.k));

/**
 * Everything a renderer needs for one point. `sim` supplies phase, amplitude,
 * bins and ripples. Returns normalised screen position, css pixel size, alpha,
 * and the lift (0..1, crest highlight) and down levels used for colour.
 */
export function fieldPoint(gx, gz, rnd, sim, out = {}) {
  const x = gx * 2 - 1;
  const down = sampleBins(sim.bins, gx);
  const w = waveHeight(x, gz, sim.phase, down);
  const rip = totalRipple(x, gz, sim.ripples);
  const k = perspective(gz);
  const p = depthP(gz);
  const off =
    w * (VIEW.ampMin + VIEW.ampRange * sim.amplitude) * (1 + VIEW.downBoost * down) +
    rip * VIEW.rippleGain;
  const lift = clamp(0.5 + off / (2 * VIEW.liftScale), 0, 1);
  const near = 1 - p;
  let alpha = (0.14 + 0.86 * Math.pow(Math.max(near, 0.0001), 1.4)) * (0.5 + 0.5 * lift);
  alpha = clamp(alpha * VIEW.alphaGain * (1 + 0.9 * down), 0, 1);
  out.sx = 0.5 + x * 0.5 * mix(VIEW.xsNear, VIEW.xsFar, p);
  out.sy = mix(VIEW.yNear, VIEW.yFar, p) - off * k;
  out.size = mix(VIEW.sizeFar, VIEW.sizeNear, near) * (0.8 + 0.4 * rnd);
  out.alpha = alpha;
  out.lift = lift;
  out.down = down;
  out.near = near;
  return out;
}

/** Dot colour (0..1 rgb) for a point from fieldPoint, mirroring the shader. */
export function pointColor(point, colors, out = [0, 0, 0]) {
  for (let c = 0; c < 3; c += 1) {
    let v = mix(colors.far[c], colors.near[c], point.near);
    v = mix(v, colors.accent[c], point.lift * 0.45);
    v = mix(v, colors.down[c], point.down * 0.85);
    out[c] = v;
  }
  return out;
}

/** Parses #rgb, #rrggbb, rgb() or rgba() (commas or spaces) to [r, g, b] in 0..1. */
export function parseCssColor(value, fallback) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((v) => clamp(Number(v) / 255, 0, 1));
  return fallback;
}

// Used only when a token cannot be read (very old browser, token removed).
const FALLBACK = {
  text: [0.93, 0.92, 0.84],
  accent: [0.89, 0.91, 0.66],
  glow: [0.47, 0.5, 0.25],
  down: [1, 0.42, 0.35],
  bg: [0.04, 0.04, 0.04],
};

/**
 * Field colours from the design tokens: near dots are --text, far dots a moss
 * tone built from --glow lifted toward --accent and sunk toward --bg, crests
 * tint toward --accent, down regions use --status-down. `additive` says whether
 * dots add light (dark theme) or sit on top like ink (--field-blend: normal). `getVar(name)` returns
 * the raw custom property value (getComputedStyle(el).getPropertyValue).
 */
export function readColors(getVar) {
  const read = (name, key) => parseCssColor(getVar(name), FALLBACK[key]);
  const text = read('--text', 'text');
  const accent = read('--accent', 'accent');
  const glow = read('--glow', 'glow');
  const bg = read('--bg', 'bg');
  const far = glow.map((v, i) => mix(mix(v, accent[i], 0.3), bg[i], 0.2));
  // Light themes draw dark dots over paper, so they blend normally, not additively.
  const additive = String(getVar('--field-blend') ?? '').trim() !== 'normal';
  return { near: text, far, accent, down: read('--status-down', 'down'), additive };
}

/**
 * The animated state both renderers draw from. Wave amplitude and speed ease
 * toward their targets (~0.6 s) and each region's down level eases over
 * ~1.5 s, so nothing ever jumps. Phase integrates the speed, so a speed
 * change speeds the wave up or slows it down without a visible skip.
 */
export function createSimulation() {
  const sim = {
    phase: 0,
    amplitude: 0.3,
    speed: 0.4,
    bins: new Float32Array(BINS),
    ripples: new Float32Array(MAX_RIPPLES * 3),
    target: { amplitude: 0.3, speed: 0.4, bins: new Float32Array(BINS) },
    setTarget({ amplitude, speed, regions }) {
      sim.target.amplitude = clamp(Number(amplitude) || 0, 0, 1);
      sim.target.speed = clamp(Number(speed) || 0, 0, 1);
      sim.target.bins = regionBins(regions);
    },
    /** Jump straight to the target (first frame, reduced motion). */
    snap() {
      sim.amplitude = sim.target.amplitude;
      sim.speed = sim.target.speed;
      sim.bins.set(sim.target.bins);
    },
    step(dt) {
      const fast = 1 - Math.exp(-dt / 0.6);
      const slow = 1 - Math.exp(-dt / 0.5); // 3 time constants ~ 1.5 s to settle
      sim.amplitude += (sim.target.amplitude - sim.amplitude) * fast;
      sim.speed += (sim.target.speed - sim.speed) * fast;
      for (let i = 0; i < BINS; i += 1) {
        sim.bins[i] += (sim.target.bins[i] - sim.bins[i]) * slow;
      }
      sim.phase += dt * phaseRate(sim.speed);
      for (let k = 0; k < MAX_RIPPLES; k += 1) {
        const o = k * 3;
        if (sim.ripples[o + 2] <= 0) continue;
        sim.ripples[o + 1] += dt;
        if (sim.ripples[o + 1] > RIPPLE.life) sim.ripples[o + 2] = 0;
      }
    },
    /** A ripple at x (0..1 along the field); replaces the oldest when all slots are busy. */
    pulse(x, strength = 0.7) {
      const s = clamp(Number(strength) || 0, 0, 1);
      if (s <= 0) return;
      let slot = 0;
      let oldest = -1;
      for (let k = 0; k < MAX_RIPPLES; k += 1) {
        if (sim.ripples[k * 3 + 2] <= 0) {
          slot = k;
          oldest = Infinity;
          break;
        }
        if (sim.ripples[k * 3 + 1] > oldest) {
          oldest = sim.ripples[k * 3 + 1];
          slot = k;
        }
      }
      sim.ripples[slot * 3] = clamp(Number(x) || 0, 0, 1) * 2 - 1;
      sim.ripples[slot * 3 + 1] = 0;
      sim.ripples[slot * 3 + 2] = s;
    },
  };
  return sim;
}

/** Phase advance in radians per second for a speed 0..1: a slow drift up to a brisk flow. */
export function phaseRate(speed) {
  return 0.35 + 1.9 * clamp(speed, 0, 1);
}
