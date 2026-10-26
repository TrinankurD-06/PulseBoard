import { describe, expect, it } from 'vitest';
import { formatDuration, formatMs, hostOf, timeAgo } from './format.js';

describe('format helpers', () => {
  it('formatDuration', () => {
    expect(formatDuration(10)).toBe('10s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(90_061)).toBe('1d 1h 1m');
    expect(formatDuration(null)).toBe('—');
  });

  it('formatMs', () => {
    expect(formatMs(87.4)).toBe('87ms');
    expect(formatMs(1534)).toBe('1.53s');
    expect(formatMs(null)).toBe('—');
  });

  it('timeAgo', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-01-01T11:59:58Z', now)).toBe('just now');
    expect(timeAgo('2026-01-01T11:59:30Z', now)).toBe('30 seconds ago');
    expect(timeAgo('2026-01-01T10:00:00Z', now)).toBe('2 hours ago');
  });

  it('hostOf', () => {
    expect(hostOf('https://api.example.com:8443/health')).toBe('api.example.com:8443');
    expect(hostOf('nonsense')).toBe('nonsense');
  });
});
