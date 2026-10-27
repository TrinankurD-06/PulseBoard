import { describe, expect, it } from 'vitest';
import { niceTicks, yAxisWidth } from './chartTheme.js';

describe('niceTicks', () => {
  it('rounds the top tick up to a round number', () => {
    expect(niceTicks(181.9)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(5.5)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(1000)).toEqual([0, 250, 500, 750, 1000]);
  });

  it('handles small values and an empty chart', () => {
    expect(niceTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(undefined)).toEqual([0, 1]);
  });
});

describe('yAxisWidth', () => {
  it('grows with the longest label and keeps a minimum', () => {
    expect(yAxisWidth(['0', '5'])).toBe(40);
    expect(yAxisWidth(['0/min', '200/min'])).toBeGreaterThan(yAxisWidth(['0/min', '50/min']));
    expect(yAxisWidth(['181.9/min'])).toBeGreaterThanOrEqual(70);
  });
});
