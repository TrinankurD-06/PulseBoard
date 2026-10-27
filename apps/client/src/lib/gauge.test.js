import { describe, expect, it } from 'vitest';
import {
  TICK_COUNT,
  clampGauge,
  filledTickCount,
  formatGaugeNumber,
  gaugeFraction,
  gaugeState,
  gaugeSummary,
  polarPoint,
  tickAngle,
  tickLine,
} from './gauge.js';

describe('clampGauge', () => {
  it('keeps in-range values', () => {
    expect(clampGauge(37, 100)).toEqual({ value: 37, max: 100 });
  });
  it('clamps negative, over-max and non-finite values', () => {
    expect(clampGauge(-5).value).toBe(0);
    expect(clampGauge(250, 100).value).toBe(100);
    expect(clampGauge(NaN).value).toBe(0);
    expect(clampGauge(Infinity).value).toBe(0);
    expect(clampGauge(undefined).value).toBe(0);
  });
  it('falls back to 100 for a bad max', () => {
    expect(clampGauge(50, 0).max).toBe(100);
    expect(clampGauge(50, -3).max).toBe(100);
    expect(clampGauge(50, NaN).max).toBe(100);
    expect(clampGauge(50, undefined).max).toBe(100);
    expect(clampGauge(50, 200)).toEqual({ value: 50, max: 200 });
  });
});

describe('gaugeFraction', () => {
  it('is value over max', () => {
    expect(gaugeFraction(25, 100)).toBe(0.25);
    expect(gaugeFraction(50, 200)).toBe(0.25);
    expect(gaugeFraction(300, 200)).toBe(1);
    expect(gaugeFraction(NaN, 200)).toBe(0);
  });
});

describe('filledTickCount', () => {
  it('is 0 for empty, all for full or over max', () => {
    expect(filledTickCount(0)).toBe(0);
    expect(filledTickCount(100)).toBe(60);
    expect(filledTickCount(140)).toBe(60);
    expect(filledTickCount(-4)).toBe(0);
    expect(filledTickCount(NaN)).toBe(0);
  });
  it('rounds to the nearest tick', () => {
    expect(filledTickCount(50)).toBe(30);
    expect(filledTickCount(37)).toBe(22); // 22.2
    expect(filledTickCount(75)).toBe(45);
  });
  it('shows at least one tick when not empty', () => {
    expect(filledTickCount(0.1)).toBe(1);
  });
  it('never shows a full ring below max', () => {
    expect(filledTickCount(99.98)).toBe(59);
    expect(filledTickCount(99.9)).toBe(59);
  });
  it('honours max and count', () => {
    expect(filledTickCount(5, 10)).toBe(30);
    expect(filledTickCount(50, 100, 10)).toBe(5);
    expect(TICK_COUNT).toBe(60);
  });
});

describe('tick geometry', () => {
  it("starts at 12 o'clock and goes clockwise", () => {
    expect(tickAngle(0)).toBe(0);
    expect(tickAngle(15)).toBe(90);
    expect(tickAngle(30)).toBe(180);
    expect(tickAngle(45)).toBe(270);
  });
  it('maps angles to SVG points', () => {
    const top = polarPoint(100, 100, 50, 0);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(50);
    const right = polarPoint(100, 100, 50, 90);
    expect(right.x).toBeCloseTo(150);
    expect(right.y).toBeCloseTo(100);
    const bottom = polarPoint(100, 100, 50, 180);
    expect(bottom.y).toBeCloseTo(150);
    const left = polarPoint(100, 100, 50, 270);
    expect(left.x).toBeCloseTo(50);
  });
  it('builds a radial tick line', () => {
    const t = tickLine(0, { cx: 120, cy: 120, rInner: 80, rOuter: 100 });
    expect(t.x1).toBeCloseTo(120);
    expect(t.y1).toBeCloseTo(40);
    expect(t.x2).toBeCloseTo(120);
    expect(t.y2).toBeCloseTo(20);
    const quarter = tickLine(15, { cx: 120, cy: 120, rInner: 80, rOuter: 100 });
    expect(quarter.x2).toBeCloseTo(220);
    expect(quarter.y2).toBeCloseTo(120);
  });
});

describe('gaugeState', () => {
  it('is neutral without a target or value', () => {
    expect(gaugeState({ value: 50 })).toBe('neutral');
    expect(gaugeState({ value: 50, target: NaN })).toBe('neutral');
    expect(gaugeState({ value: NaN, target: 90 })).toBe('neutral');
  });
  it('above: below the target is down, equal counts as ok', () => {
    expect(gaugeState({ value: 99.5, target: 99.9 })).toBe('down');
    expect(gaugeState({ value: 99.9, target: 99.9 })).toBe('ok');
    expect(gaugeState({ value: 99.98, target: 99.9 })).toBe('ok');
  });
  it('below: over the target is down, equal counts as ok', () => {
    expect(gaugeState({ value: 450, target: 300, direction: 'below' })).toBe('down');
    expect(gaugeState({ value: 300, target: 300, direction: 'below' })).toBe('ok');
    expect(gaugeState({ value: 120, target: 300, direction: 'below' })).toBe('ok');
  });
  it('handles a zero target', () => {
    expect(gaugeState({ value: 0, target: 0 })).toBe('ok');
    expect(gaugeState({ value: 1, target: 0, direction: 'below' })).toBe('down');
  });
});

describe('formatGaugeNumber', () => {
  it('auto decimals: whole stays whole, otherwise up to 2 trimmed', () => {
    expect(formatGaugeNumber(100)).toBe('100');
    expect(formatGaugeNumber(99.98)).toBe('99.98');
    expect(formatGaugeNumber(99.5)).toBe('99.5');
    expect(formatGaugeNumber(37.004)).toBe('37');
    expect(formatGaugeNumber(0)).toBe('0');
  });
  it('fixed decimals', () => {
    expect(formatGaugeNumber(99.9, { decimals: 2 })).toBe('99.90');
    expect(formatGaugeNumber(99.987, { decimals: 1 })).toBe('100.0');
    expect(formatGaugeNumber(12, { decimals: 0 })).toBe('12');
  });
  it('thousands separators', () => {
    expect(formatGaugeNumber(1234567, { thousands: true })).toBe('1,234,567');
    expect(formatGaugeNumber(1234.5, { thousands: true })).toBe('1,234.5');
    expect(formatGaugeNumber(999, { thousands: true })).toBe('999');
    expect(formatGaugeNumber(-12345, { thousands: true })).toBe('-12,345');
    expect(formatGaugeNumber(1000, { thousands: true, decimals: 2 })).toBe('1,000.00');
  });
  it('is safe with non-finite and tiny negatives', () => {
    expect(formatGaugeNumber(NaN)).toBe('0');
    expect(formatGaugeNumber(undefined)).toBe('0');
    expect(formatGaugeNumber(-0.001, { decimals: 2 })).toBe('0.00');
  });
});

describe('gaugeSummary', () => {
  it('describes value, target and result', () => {
    expect(gaugeSummary({ label: 'Uptime', value: 99.98, target: 99.9 })).toBe(
      'Uptime 99.98 percent, target 99.9, meeting target',
    );
  });
  it('reports a missed target', () => {
    expect(gaugeSummary({ label: 'Uptime', value: 98, target: 99.9 })).toBe(
      'Uptime 98 percent, target 99.9, missing target',
    );
    expect(
      gaugeSummary({ label: 'p95', value: 450, unit: 'ms', target: 300, direction: 'below' }),
    ).toBe('p95 450 ms, target 300, missing target');
  });
  it('works without label, unit or target', () => {
    expect(gaugeSummary({ value: 37, unit: '' })).toBe('37');
    expect(gaugeSummary({ value: 5, max: 10, unit: 'GB' })).toBe('5 GB of 10');
  });
});
