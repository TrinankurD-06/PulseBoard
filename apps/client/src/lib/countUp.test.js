import { describe, expect, it } from 'vitest';
import { countUpValue, cubicBezier, easeOutSoft, progressAt } from './countUp.js';

describe('cubicBezier', () => {
  it('hits the endpoints and clamps outside 0..1', () => {
    expect(easeOutSoft(0)).toBe(0);
    expect(easeOutSoft(1)).toBe(1);
    expect(easeOutSoft(-1)).toBe(0);
    expect(easeOutSoft(2)).toBe(1);
    expect(easeOutSoft(NaN)).toBe(0);
  });

  it('is monotonic and front-loaded (ease out)', () => {
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const y = easeOutSoft(t);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(easeOutSoft(0.5)).toBeGreaterThan(0.5);
  });

  it('a linear curve is the identity', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    expect(linear(0.8)).toBeCloseTo(0.8, 4);
  });
});

describe('progressAt', () => {
  it('maps elapsed time to 0..1', () => {
    expect(progressAt(0, 800)).toBe(0);
    expect(progressAt(400, 800)).toBe(0.5);
    expect(progressAt(800, 800)).toBe(1);
    expect(progressAt(5000, 800)).toBe(1);
    expect(progressAt(-10, 800)).toBe(0);
  });

  it('treats a bad duration as already finished', () => {
    expect(progressAt(10, 0)).toBe(1);
    expect(progressAt(10, NaN)).toBe(1);
    expect(progressAt(NaN, 800)).toBe(0);
  });
});

describe('countUpValue', () => {
  it('starts at from, ends exactly at to', () => {
    expect(countUpValue(0, 99.98, 0, 800)).toBe(0);
    expect(countUpValue(0, 99.98, 800, 800)).toBe(99.98);
    expect(countUpValue(0, 99.98, 9999, 800)).toBe(99.98);
  });

  it('is between from and to mid-way, and counts down too', () => {
    const mid = countUpValue(0, 100, 400, 800);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    const down = countUpValue(100, 0, 400, 800);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThan(100);
  });

  it('is safe with non-finite input', () => {
    expect(countUpValue(NaN, 10, 0, 800)).toBe(0);
    expect(countUpValue(5, NaN, 400, 800)).toBe(5);
    expect(countUpValue(0, 10, 100, 0)).toBe(10);
  });
});
