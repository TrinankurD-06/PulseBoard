import { describe, expect, it } from 'vitest';
import { uptimeGaugeProps } from './uptimeLevels.js';

describe('uptimeGaugeProps', () => {
  it('prints what the card prints: cut to 2 decimals, 100 only when perfect', () => {
    expect(uptimeGaugeProps(100)).toEqual({ value: 100, decimals: 0 });
    // Rounding this to 1 decimal is what once showed "100.0" on the gauge.
    expect(uptimeGaugeProps(99.96)).toEqual({ value: 99.96, decimals: 2 });
    expect(uptimeGaugeProps(99.999)).toEqual({ value: 99.99, decimals: 2 });
    expect(uptimeGaugeProps(98.958)).toEqual({ value: 98.95, decimals: 2 });
  });

  it('has no value without data', () => {
    expect(uptimeGaugeProps(null)).toEqual({ value: null, decimals: 2 });
    expect(uptimeGaugeProps(undefined)).toEqual({ value: null, decimals: 2 });
  });
});
