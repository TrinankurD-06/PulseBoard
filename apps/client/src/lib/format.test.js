import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatCurrency,
  formatDuration,
  formatMonth,
  formatMs,
  hostOf,
  timeAgo,
  timeAgoShort,
} from './format.js';

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
    expect(timeAgo('2026-01-01T12:00:14Z', now)).toBe('just now'); // newer than now
  });

  it('timeAgoShort', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgoShort('2026-01-01T11:59:26Z', now)).toBe('34s ago');
    expect(timeAgoShort('2026-01-01T09:30:00Z', now)).toBe('2h ago');
    expect(timeAgoShort('2026-01-01T12:00:09Z', now)).toBe('just now');
  });

  it('formatCurrency', () => {
    expect(formatCurrency(432, 'INR')).toBe('₹432');
    expect(formatCurrency(0.62, 'INR')).toBe('₹0.62');
    expect(formatCurrency(100000, 'INR')).toBe('₹1,00,000');
    expect(formatCurrency(21.6, 'USD')).toBe('$21.6');
    expect(formatCurrency(null)).toBe('—');
  });

  it('formatCount and formatMonth', () => {
    expect(formatCount(43200)).toBe('43,200');
    expect(formatCount(null)).toBe('—');
    expect(formatMonth('2026-10')).toBe('October 2026');
  });

  it('hostOf', () => {
    expect(hostOf('https://api.example.com:8443/health')).toBe('api.example.com:8443');
    expect(hostOf('nonsense')).toBe('nonsense');
  });
});
