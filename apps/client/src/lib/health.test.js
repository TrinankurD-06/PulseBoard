import { describe, expect, it } from 'vitest';
import {
  formatChange,
  formatMetricText,
  formatMetricValue,
  nextIndex,
  resolveSelection,
  seriesDomain,
} from './health.js';

describe('formatMetricValue', () => {
  it('formats each unit', () => {
    expect(formatMetricValue(99.93, '%')).toEqual({ text: '99.93', unit: '%' });
    expect(formatMetricValue(100, '%')).toEqual({ text: '100', unit: '%' });
    expect(formatMetricValue(0, '%')).toEqual({ text: '0', unit: '%' });
    expect(formatMetricValue(182.4, 'ms')).toEqual({ text: '182', unit: 'ms' });
    expect(formatMetricValue(0.43, 'ms')).toEqual({ text: '0.4', unit: 'ms' });
    expect(formatMetricValue(7, 'ms')).toEqual({ text: '7', unit: 'ms' });
    expect(formatMetricValue(1420, 'ms')).toEqual({ text: '1.42', unit: 's' });
    expect(formatMetricValue(0.354, 'req/s')).toEqual({ text: '0.35', unit: 'req/s' });
    expect(formatMetricValue(1204, 'pings')).toEqual({ text: '1,204', unit: 'pings' });
    expect(formatMetricValue(1, 'pings').unit).toBe('ping');
  });

  it('renders null as a dash without a unit', () => {
    expect(formatMetricValue(null, 'ms')).toEqual({ text: '—', unit: '' });
    expect(formatMetricValue(undefined, '%')).toEqual({ text: '—', unit: '' });
  });

  it('formatMetricText joins value and unit', () => {
    expect(formatMetricText(99.9, '%')).toBe('99.9%');
    expect(formatMetricText(240, 'ms')).toBe('240 ms');
    expect(formatMetricText(null, 'ms')).toBe('—');
  });
});

describe('formatChange', () => {
  it('uses arrows for direction and a dash for null', () => {
    expect(formatChange(2.34, 'p95')).toMatchObject({ text: '2.3%', arrow: '↗', direction: 'up' });
    expect(formatChange(-12, 'p95')).toMatchObject({ text: '12%', arrow: '↘', direction: 'down' });
    expect(formatChange(null, 'p95')).toEqual({
      text: '—',
      arrow: '',
      direction: 'none',
      bad: false,
    });
    expect(formatChange(0.02, 'p95')).toMatchObject({ text: '0%', arrow: '', direction: 'flat' });
  });

  it('only flags the clearly bad directions', () => {
    expect(formatChange(5, 'failed').bad).toBe(true);
    expect(formatChange(-5, 'failed').bad).toBe(false);
    expect(formatChange(5, 'errorRate').bad).toBe(true);
    expect(formatChange(5, 'missed').bad).toBe(true);
    expect(formatChange(-0.5, 'uptime').bad).toBe(true);
    expect(formatChange(0.5, 'uptime').bad).toBe(false);
    expect(formatChange(50, 'p95').bad).toBe(false);
    expect(formatChange(-50, 'requestRate').bad).toBe(false);
  });
});

describe('resolveSelection', () => {
  const keys = ['uptime', 'p95', 'failed'];
  it('keeps a key that still exists, else the first', () => {
    expect(resolveSelection(keys, 'p95')).toBe('p95');
    expect(resolveSelection(keys, 'missed')).toBe('uptime');
    expect(resolveSelection(keys, null)).toBe('uptime');
    expect(resolveSelection([], 'p95')).toBeNull();
  });
});

describe('nextIndex', () => {
  it('moves with arrows and wraps', () => {
    expect(nextIndex(4, 0, 'ArrowRight')).toBe(1);
    expect(nextIndex(4, 3, 'ArrowRight')).toBe(0);
    expect(nextIndex(4, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(4, 0, 'ArrowLeft')).toBe(3);
    expect(nextIndex(4, 2, 'ArrowUp')).toBe(1);
  });
  it('supports Home and End and ignores other keys', () => {
    expect(nextIndex(4, 2, 'Home')).toBe(0);
    expect(nextIndex(4, 1, 'End')).toBe(3);
    expect(nextIndex(4, 1, 'a')).toBeNull();
    expect(nextIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});

describe('seriesDomain', () => {
  it('pads percentages, starts others at zero, survives no data', () => {
    const [lo, hi] = seriesDomain([99, null, 100], '%');
    expect(lo).toBeLessThan(99);
    expect(hi).toBe(100);
    expect(seriesDomain([10, 200], 'ms')[0]).toBe(0);
    expect(seriesDomain([null], 'ms')).toEqual([0, 1]);
    expect(seriesDomain([0, 0], 'pings')).toEqual([0, 1]);
  });
});
