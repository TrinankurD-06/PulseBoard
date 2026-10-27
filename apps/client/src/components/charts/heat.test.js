import { describe, expect, it } from 'vitest';
import { heatColorAt, heatStops, lineHeat, svgId } from './heat.js';

describe('heatColorAt', () => {
  it('returns the ramp steps exactly at their positions', () => {
    expect(heatColorAt(0)).toBe('var(--color-heat-low)');
    expect(heatColorAt(0.5)).toBe('var(--color-heat-mid)');
    expect(heatColorAt(1)).toBe('var(--color-heat-high)');
  });

  it('mixes the neighbouring steps in between', () => {
    expect(heatColorAt(0.25)).toBe(
      'color-mix(in oklab, var(--color-heat-mid) 50%, var(--color-heat-low))',
    );
    expect(heatColorAt(0.9)).toBe(
      'color-mix(in oklab, var(--color-heat-high) 80%, var(--color-heat-mid))',
    );
  });

  it('clamps out-of-range and invalid input', () => {
    expect(heatColorAt(-2)).toBe('var(--color-heat-low)');
    expect(heatColorAt(7)).toBe('var(--color-heat-high)');
    expect(heatColorAt(NaN)).toBe('var(--color-heat-low)');
  });
});

describe('heatStops', () => {
  it('covers the whole ramp for a shape that starts at zero (an area)', () => {
    expect(heatStops(0)).toEqual([
      { offset: 0, color: 'var(--color-heat-low)' },
      { offset: 0.5, color: 'var(--color-heat-mid)' },
      { offset: 1, color: 'var(--color-heat-high)' },
    ]);
  });

  it('starts part-way up the ramp for a line whose minimum is above zero', () => {
    const stops = heatStops(0.6);
    expect(stops[0]).toEqual({
      offset: 0,
      color: 'color-mix(in oklab, var(--color-heat-high) 20%, var(--color-heat-mid))',
    });
    expect(stops.at(-1)).toEqual({ offset: 1, color: 'var(--color-heat-high)' });
    expect(stops).toHaveLength(2);
  });

  it('places the mid step proportionally', () => {
    expect(heatStops(0.2)[1]).toEqual({ offset: 0.375, color: 'var(--color-heat-mid)' });
  });

  it('ends part-way up the ramp for a line that stays below the chart top', () => {
    expect(heatStops(0, 0.5)).toEqual([
      { offset: 0, color: 'var(--color-heat-low)' },
      { offset: 1, color: 'var(--color-heat-mid)' },
    ]);
  });

  it('is a single colour when the shape has no height', () => {
    expect(heatStops(1)).toEqual([{ offset: 0, color: 'var(--color-heat-high)' }]);
    expect(heatStops(0.5, 0.5)).toEqual([{ offset: 0, color: 'var(--color-heat-mid)' }]);
  });
});

describe('lineHeat', () => {
  it('maps a line onto the ramp relative to the axis top', () => {
    expect(lineHeat(50, 150, 200)).toEqual({ from: 0.25, to: 0.75 });
  });

  it('returns null for flat lines and empty axes', () => {
    expect(lineHeat(120, 120, 200)).toBeNull();
    expect(lineHeat(0, 0, 0)).toBeNull();
  });
});

describe('svgId', () => {
  it('strips the colons React puts in ids', () => {
    expect(svgId(':r1a:', 'heat')).toBe('heat-r1a');
  });
});
