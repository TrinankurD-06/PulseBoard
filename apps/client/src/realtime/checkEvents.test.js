import { describe, expect, it, vi } from 'vitest';
import { onCheckResult, publishCheckEvent, subscribeCheckEvents } from './checkEvents.js';

describe('checkEvents', () => {
  it('delivers events to subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribeCheckEvents(listener);
    publishCheckEvent('check:result', { monitorId: 'a' });
    expect(listener).toHaveBeenCalledWith({ type: 'check:result', payload: { monitorId: 'a' } });
    off();
    publishCheckEvent('check:result', { monitorId: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onCheckResult only receives check results', () => {
    const listener = vi.fn();
    const off = onCheckResult(listener);
    publishCheckEvent('incident:opened', { id: 'i' });
    publishCheckEvent('check:result', { monitorId: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ monitorId: 'a' });
    off();
  });

  it('a throwing listener does not stop the others', () => {
    const good = vi.fn();
    const offBad = subscribeCheckEvents(() => {
      throw new Error('boom');
    });
    const offGood = subscribeCheckEvents(good);
    expect(() => publishCheckEvent('check:result', {})).not.toThrow();
    expect(good).toHaveBeenCalled();
    offBad();
    offGood();
  });
});
