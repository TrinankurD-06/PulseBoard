import { describe, expect, it } from 'vitest';
import {
  BINS,
  MAX_POINTS,
  MAX_RIPPLES,
  SMALL_POINTS,
  createSimulation,
  depthP,
  fieldPoint,
  generateGrid,
  gridDims,
  parseCssColor,
  phaseRate,
  readColors,
  regionBins,
  rippleHeight,
  sampleBins,
  selectPointBudget,
  totalRipple,
  waveHeight,
} from './fieldMath.js';

describe('selectPointBudget', () => {
  it('gives desktop up to 20k points', () => {
    expect(selectPointBudget({ width: 1440, height: 280, cores: 8 })).toBe(MAX_POINTS);
  });
  it('uses about 6k below 768px or on low-power devices', () => {
    expect(selectPointBudget({ width: 390, height: 280, cores: 8 })).toBeLessThanOrEqual(
      SMALL_POINTS,
    );
    expect(selectPointBudget({ width: 1440, height: 280, cores: 4 })).toBe(SMALL_POINTS);
  });
  it('never exceeds one point per ~14 px of area', () => {
    expect(selectPointBudget({ width: 300, height: 100, cores: 8 })).toBeLessThanOrEqual(2143);
  });
  it('honours low, high and numeric densities, within limits', () => {
    expect(selectPointBudget({ width: 1440, height: 400, density: 'low' })).toBe(SMALL_POINTS);
    expect(selectPointBudget({ width: 390, height: 400, cores: 2, density: 'high' })).toBe(
      Math.round((390 * 400) / 14),
    );
    expect(selectPointBudget({ density: 99999 })).toBe(MAX_POINTS);
    expect(selectPointBudget({ density: 10 })).toBe(500);
  });
});

describe('gridDims and generateGrid', () => {
  it('stays within the budget and keeps a wide aspect', () => {
    const d = gridDims(20000, 5);
    expect(d.count).toBeLessThanOrEqual(20000);
    expect(d.count).toBeGreaterThan(18000);
    expect(d.cols).toBeGreaterThan(d.rows * 2);
  });
  it('generates in-range, deterministic triplets', () => {
    const a = generateGrid(20, 10);
    const b = generateGrid(20, 10);
    expect(a).toHaveLength(20 * 10 * 3);
    expect([...a]).toEqual([...b]);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('waveHeight', () => {
  it('is bounded and deterministic without turbulence', () => {
    for (let i = 0; i < 200; i += 1) {
      const h = waveHeight(Math.sin(i), i / 200, i * 0.1, 0);
      expect(Math.abs(h)).toBeLessThanOrEqual(1.0001);
      expect(h).toBe(waveHeight(Math.sin(i), i / 200, i * 0.1, 0));
    }
  });
  it('travels with the phase', () => {
    expect(waveHeight(0.2, 0.5, 0)).not.toBeCloseTo(waveHeight(0.2, 0.5, 1));
  });
  it('turbulence adds energy', () => {
    let rough = 0;
    for (let i = 0; i < 300; i += 1) {
      const x = (i / 300) * 2 - 1;
      rough += (waveHeight(x, 0.4, 2, 1) - waveHeight(x, 0.4, 2, 0)) ** 2;
    }
    expect(rough).toBeGreaterThan(1);
  });
});

describe('rippleHeight', () => {
  it('ignores unused slots', () => {
    expect(rippleHeight(0, 0.5, 0, 1, 0)).toBe(0);
  });
  it('is local: far from the ring it is ~0', () => {
    expect(Math.abs(rippleHeight(0.95, 0.5, -0.9, 0.2, 1))).toBeLessThan(1e-6);
  });
  it('is strongest at the ring and fades with age', () => {
    let peakEarly = 0;
    let peakLate = 0;
    for (let x = -1; x <= 1; x += 0.01) {
      peakEarly = Math.max(peakEarly, Math.abs(rippleHeight(x, 0.5, 0, 0.3, 1)));
      peakLate = Math.max(peakLate, Math.abs(rippleHeight(x, 0.5, 0, 3.8, 1)));
    }
    expect(peakEarly).toBeGreaterThan(0.5);
    expect(peakLate).toBeLessThan(0.1);
  });
  it('sums the packed ripples', () => {
    const r = new Float32Array(MAX_RIPPLES * 3);
    r.set([0, 0.2, 1, 0.5, 0.4, 0.5]);
    const expected = rippleHeight(0.1, 0.5, 0, 0.2, 1) + rippleHeight(0.1, 0.5, 0.5, 0.4, 0.5);
    expect(totalRipple(0.1, 0.5, r)).toBeCloseTo(expected, 5);
  });
});

describe('regions', () => {
  it('marks down regions and leaves ok regions alone', () => {
    const bins = regionBins([
      { x0: 0, x1: 0.25, state: 'ok' },
      { x0: 0.5, x1: 0.75, state: 'down' },
    ]);
    expect(bins).toHaveLength(BINS);
    expect(sampleBins(bins, 0.1)).toBe(0);
    expect(sampleBins(bins, 0.62)).toBeGreaterThan(0.9);
    expect(sampleBins(bins, 0.95)).toBe(0);
  });
  it('softens the edges', () => {
    const bins = regionBins([{ x0: 0.5, x1: 0.75, state: 'down' }]);
    const edge = sampleBins(bins, 0.5);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });
  it('keeps a region narrower than a bin visible', () => {
    const bins = regionBins([{ x0: 0.301, x1: 0.302, state: 'down' }]);
    expect(Math.max(...bins)).toBeGreaterThan(0.2);
  });
  it('handles no regions', () => {
    expect(Math.max(...regionBins(undefined))).toBe(0);
  });
  it('interpolates between bins and clamps', () => {
    const bins = new Float32Array([0, 1]);
    expect(sampleBins(bins, 0.5)).toBeCloseTo(0.5);
    expect(sampleBins(bins, -1)).toBe(0);
    expect(sampleBins(bins, 2)).toBe(1);
  });
});

describe('fieldPoint', () => {
  it('draws nearer points lower, larger and brighter than far ones', () => {
    const sim = createSimulation();
    const near = fieldPoint(0.5, 0.02, 0.5, sim, {});
    const far = fieldPoint(0.5, 0.98, 0.5, sim, {});
    expect(near.sy).toBeGreaterThan(far.sy);
    expect(near.size).toBeGreaterThan(far.size);
    expect(near.alpha).toBeGreaterThan(far.alpha);
    expect(depthP(0)).toBeCloseTo(0);
    expect(depthP(1)).toBeCloseTo(1);
  });
  it('keeps every point inside the banner with small dots at amplitude 1', () => {
    const tall = createSimulation();
    tall.amplitude = 1;
    for (let i = 0; i < 400; i += 1) {
      tall.phase = i * 0.37;
      const p = fieldPoint((i % 20) / 20, (i % 17) / 17, 0.5, tall, {});
      expect(p.sy).toBeGreaterThan(0.1);
      expect(p.sy).toBeLessThan(1.06);
      expect(p.size).toBeGreaterThanOrEqual(0.8);
      expect(p.size).toBeLessThanOrEqual(2.6);
    }
  });
  it('reports the down level of the region the point sits in', () => {
    const s = createSimulation();
    s.setTarget({ amplitude: 0.3, speed: 0.4, regions: [{ x0: 0.4, x1: 0.6, state: 'down' }] });
    s.snap();
    expect(fieldPoint(0.5, 0.5, 0.5, s, {}).down).toBeGreaterThan(0.9);
    expect(fieldPoint(0.1, 0.5, 0.5, s, {}).down).toBe(0);
  });
});

describe('createSimulation', () => {
  it('eases a region to down over about 1.5 s, never jumping', () => {
    const s = createSimulation();
    s.setTarget({ amplitude: 0.3, speed: 0.4, regions: [{ x0: 0.4, x1: 0.6, state: 'down' }] });
    s.step(1 / 60);
    const first = sampleBins(s.bins, 0.5);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.1);
    for (let i = 0; i < 90; i += 1) s.step(1 / 60);
    expect(sampleBins(s.bins, 0.5)).toBeGreaterThan(0.9);
  });
  it('settles back to ok smoothly', () => {
    const s = createSimulation();
    s.setTarget({ amplitude: 0.3, speed: 0.4, regions: [{ x0: 0.4, x1: 0.6, state: 'down' }] });
    s.snap();
    s.setTarget({ amplitude: 0.3, speed: 0.4, regions: [] });
    s.step(0.1);
    expect(sampleBins(s.bins, 0.5)).toBeGreaterThan(0.7);
    for (let i = 0; i < 120; i += 1) s.step(1 / 60);
    expect(sampleBins(s.bins, 0.5)).toBeLessThan(0.1);
  });
  it('integrates speed into phase', () => {
    const s = createSimulation();
    s.snap();
    s.step(1);
    expect(s.phase).toBeCloseTo(phaseRate(0.4), 1);
    expect(phaseRate(1)).toBeGreaterThan(phaseRate(0));
  });
  it('clamps the targets', () => {
    const s = createSimulation();
    s.setTarget({ amplitude: 7, speed: -2 });
    s.snap();
    expect(s.amplitude).toBe(1);
    expect(s.speed).toBe(0);
  });
  it('launches, ages and retires ripples; reuses the oldest slot when full', () => {
    const s = createSimulation();
    s.pulse(0.5, 0.8);
    expect(s.ripples[0]).toBeCloseTo(0);
    expect(s.ripples[2]).toBeCloseTo(0.8);
    s.step(1);
    expect(s.ripples[1]).toBeCloseTo(1);
    s.step(4);
    expect(s.ripples[2]).toBe(0);
    for (let i = 0; i < MAX_RIPPLES; i += 1) {
      s.pulse(i / MAX_RIPPLES, 0.5);
      s.step(0.1);
    }
    s.pulse(0.99, 1);
    const xs = Array.from({ length: MAX_RIPPLES }, (_, k) => s.ripples[k * 3]);
    expect(xs.some((x) => Math.abs(x - (0.99 * 2 - 1)) < 1e-5)).toBe(true);
    const active = xs.filter((_, k) => s.ripples[k * 3 + 2] > 0);
    expect(active).toHaveLength(MAX_RIPPLES);
  });
});

describe('colours', () => {
  it('parses hex and rgb forms', () => {
    expect(parseCssColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseCssColor(' #0f0 ')).toEqual([0, 1, 0]);
    expect(parseCssColor('rgba(255, 255, 255, 0.35)')).toEqual([1, 1, 1]);
    expect(parseCssColor('rgb(0 51 255 / 50%)')[1]).toBeCloseTo(0.2);
    expect(parseCssColor('nope', [9, 9, 9])).toEqual([9, 9, 9]);
  });
  it('reads the token set, falling back when a token is missing', () => {
    const vars = { '--text': '#ffffff', '--status-down': '#ff0000' };
    const c = readColors((name) => vars[name] ?? '');
    expect(c.near).toEqual([1, 1, 1]);
    expect(c.down).toEqual([1, 0, 0]);
    expect(c.far).toHaveLength(3);
    expect(c.accent).toHaveLength(3);
  });
});

describe('colours by theme', () => {
  it('adds light by default and blends normally when the token says so', () => {
    expect(readColors(() => '').additive).toBe(true);
    expect(readColors((name) => (name === '--field-blend' ? ' add ' : '')).additive).toBe(true);
    expect(readColors((name) => (name === '--field-blend' ? ' normal ' : '')).additive).toBe(false);
  });
});
