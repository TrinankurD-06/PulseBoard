import { describe, expect, it } from 'vitest';
import {
  AMPLITUDE_FLOOR,
  IDLE_AMPLITUDE,
  IDLE_SPEED,
  amplitudeFromLatency,
  amplitudeFromSparklines,
  countDown,
  demoSignalAt,
  pulseStrength,
  regionsFromMonitors,
  signalLabel,
  slotCenter,
  speedFromInterval,
  speedFromMonitors,
  statusSignal,
} from './signal.js';

describe('amplitudeFromLatency', () => {
  it('maps the documented scale', () => {
    expect(amplitudeFromLatency(50)).toBe(AMPLITUDE_FLOOR);
    expect(amplitudeFromLatency(150)).toBeCloseTo(0.1);
    expect(amplitudeFromLatency(400)).toBeCloseTo(0.37, 1);
    expect(amplitudeFromLatency(1000)).toBeCloseTo(0.62, 1);
    expect(amplitudeFromLatency(4000)).toBeCloseTo(1);
    expect(amplitudeFromLatency(60000)).toBe(1);
  });
  it('is monotonic and handles junk', () => {
    expect(amplitudeFromLatency(300)).toBeLessThan(amplitudeFromLatency(900));
    expect(amplitudeFromLatency(NaN)).toBe(AMPLITUDE_FLOOR);
    expect(amplitudeFromLatency(null)).toBe(AMPLITUDE_FLOOR);
  });
});

describe('amplitudeFromSparklines', () => {
  const pts = (...ms) => ms.map((m, i) => ({ t: String(i), ms: m, ok: true }));
  it('is idle without data', () => {
    expect(amplitudeFromSparklines(undefined)).toBe(IDLE_AMPLITUDE);
    expect(amplitudeFromSparklines({ a: [] })).toBe(IDLE_AMPLITUDE);
  });
  it('is low for quick monitors and high for slow ones', () => {
    const calm = amplitudeFromSparklines({ a: pts(120, 130, 110), b: pts(140, 150, 135) });
    const slow = amplitudeFromSparklines({ a: pts(2500, 3000, 2800), b: pts(3500, 3200, 3300) });
    expect(calm).toBeLessThan(0.2);
    expect(slow).toBeGreaterThan(0.8);
  });
  it('lets one slow monitor show but not dominate', () => {
    const one = amplitudeFromSparklines({ a: pts(120, 120), b: pts(120, 120), c: pts(2000, 2000) });
    expect(one).toBeGreaterThan(amplitudeFromSparklines({ a: pts(120), b: pts(120), c: pts(120) }));
    expect(one).toBeLessThan(amplitudeFromLatency(2000));
  });
  it('ignores failed checks and resists one outlier', () => {
    const failed = [
      { t: '1', ms: null, ok: false },
      { t: '2', ms: 5000, ok: false },
      ...pts(120, 130, 125),
    ];
    expect(amplitudeFromSparklines({ a: failed })).toBeLessThan(0.15);
    expect(amplitudeFromSparklines({ a: pts(120, 125, 9000, 130, 128) })).toBeLessThan(0.2);
  });
});

describe('speed', () => {
  it('maps the documented scale', () => {
    expect(speedFromInterval(10)).toBe(1);
    expect(speedFromInterval(30)).toBe(1);
    expect(speedFromInterval(300)).toBeCloseTo(0.59, 1);
    expect(speedFromInterval(3600)).toBeCloseTo(0.15);
    expect(speedFromInterval(86400)).toBeCloseTo(0.15);
    expect(speedFromInterval(0)).toBe(IDLE_SPEED);
  });
  it('shorter intervals flow faster', () => {
    expect(speedFromInterval(60)).toBeGreaterThan(speedFromInterval(600));
  });
  it('uses the geometric mean of active monitors', () => {
    const fast = speedFromMonitors([{ intervalSec: 30 }, { intervalSec: 30 }]);
    const mixed = speedFromMonitors([{ intervalSec: 30 }, { intervalSec: 3600 }]);
    const paused = speedFromMonitors([
      { intervalSec: 30 },
      { intervalSec: 3600, status: 'paused' },
    ]);
    expect(fast).toBe(1);
    expect(mixed).toBeLessThan(fast);
    expect(paused).toBe(1);
    expect(speedFromMonitors([])).toBe(IDLE_SPEED);
    expect(speedFromMonitors(undefined)).toBe(IDLE_SPEED);
  });
});

describe('regions and slots', () => {
  const monitors = [
    { id: 'a', status: 'up' },
    { id: 'b', status: 'down' },
    { id: 'c', status: 'paused' },
    { id: 'd', status: 'pending' },
  ];
  it('gives each monitor an equal slot; only down is down', () => {
    const regions = regionsFromMonitors(monitors);
    expect(regions).toEqual([
      { x0: 0, x1: 0.25, state: 'ok' },
      { x0: 0.25, x1: 0.5, state: 'down' },
      { x0: 0.5, x1: 0.75, state: 'ok' },
      { x0: 0.75, x1: 1, state: 'ok' },
    ]);
    expect(countDown(regions)).toBe(1);
  });
  it('handles empty input', () => {
    expect(regionsFromMonitors([])).toEqual([]);
    expect(regionsFromMonitors(undefined)).toEqual([]);
  });
  it('finds a monitor slot centre', () => {
    expect(slotCenter(monitors, 'a')).toBeCloseTo(0.125);
    expect(slotCenter(monitors, 'd')).toBeCloseTo(0.875);
    expect(slotCenter(monitors, 'zzz')).toBeNull();
    expect(slotCenter(undefined, 'a')).toBeNull();
  });
});

describe('pulseStrength', () => {
  it('is full for a failure and 0.3-0.7 for a success', () => {
    expect(pulseStrength({ ok: false, ms: null })).toBe(1);
    expect(pulseStrength({ ok: true, ms: 100 })).toBeCloseTo(0.3);
    expect(pulseStrength({ ok: true, ms: 4000 })).toBeCloseTo(0.7);
    expect(pulseStrength({ ok: true, ms: 800 })).toBeGreaterThan(
      pulseStrength({ ok: true, ms: 200 }),
    );
  });
});

describe('labels and public/demo signals', () => {
  it('describes the live state', () => {
    expect(signalLabel([])).toBe('Live signal: all monitors calm');
    expect(signalLabel([{ state: 'ok' }])).toBe('Live signal: all monitors calm');
    expect(signalLabel([{ state: 'down' }])).toBe('Live signal: 1 monitor down');
    expect(signalLabel([{ state: 'down' }, { state: 'down' }])).toBe(
      'Live signal: 2 monitors down',
    );
  });
  it('status signal is calm until something is down', () => {
    const calm = statusSignal([{ id: 'a', status: 'up' }]);
    const bad = statusSignal([{ id: 'a', status: 'down' }]);
    expect(calm.amplitude).toBeLessThan(bad.amplitude);
    expect(calm.speed).toBeLessThan(bad.speed);
    expect(bad.regions[0].state).toBe('down');
  });
  it('demo signal stays gentle', () => {
    for (let t = 0; t < 600; t += 7) {
      const s = demoSignalAt(t);
      expect(s.amplitude).toBeGreaterThan(0.15);
      expect(s.amplitude).toBeLessThan(0.55);
      expect(s.speed).toBeGreaterThan(0.25);
      expect(s.speed).toBeLessThan(0.55);
    }
  });
});
