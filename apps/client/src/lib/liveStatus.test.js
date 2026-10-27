import { describe, expect, it } from 'vitest';
import { liveStatus } from './liveStatus.js';

describe('liveStatus', () => {
  it('says offline whenever the socket is down, whatever the incidents', () => {
    expect(liveStatus({ connected: false, openIncidents: 3 })).toMatchObject({
      key: 'offline',
      label: 'Offline',
      pulse: false,
    });
  });

  it('counts open incidents with the right plural', () => {
    expect(liveStatus({ connected: true, openIncidents: 1 }).label).toBe('1 incident open');
    expect(liveStatus({ connected: true, openIncidents: 4 }).label).toBe('4 incidents open');
    expect(liveStatus({ connected: true, openIncidents: 2 }).dot).toBe('bg-status-down');
  });

  it('is calm and pulsing with no incidents or while the count is unknown', () => {
    expect(liveStatus({ connected: true, openIncidents: 0 })).toMatchObject({
      key: 'normal',
      label: 'All systems normal',
      pulse: true,
    });
    expect(liveStatus({ connected: true, openIncidents: null }).key).toBe('normal');
  });
});
