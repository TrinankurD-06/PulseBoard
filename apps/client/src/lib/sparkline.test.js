import { describe, expect, it } from 'vitest';
import { sparkValue } from './sparkline.js';

describe('sparkValue', () => {
  it('uses the response time', () => {
    expect(sparkValue({ ms: 120, ok: true })).toBe(120);
  });
  it('puts a failed check on the baseline', () => {
    expect(sparkValue({ ms: null, ok: false })).toBe(0);
  });
  it('leaves a gap for an unknown (checker offline) result', () => {
    expect(sparkValue({ ms: null, ok: false, state: 'unknown' })).toBeNull();
  });
  it('leaves a gap for a passed check without a time', () => {
    expect(sparkValue({ ms: null, ok: true })).toBeNull();
  });
});
