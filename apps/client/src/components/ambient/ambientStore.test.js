import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAmbientAlert, setAmbientAlert, subscribeAmbientAlert } from './ambientStore.js';

describe('ambient alert store', () => {
  afterEach(() => setAmbientAlert(false));

  it('starts calm', () => {
    expect(getAmbientAlert()).toBe(false);
  });

  it('notifies subscribers only when the value changes, and stops after unsubscribe', () => {
    const spy = vi.fn();
    const unsubscribe = subscribeAmbientAlert(spy);
    setAmbientAlert(true);
    setAmbientAlert(true);
    setAmbientAlert(false);
    unsubscribe();
    setAmbientAlert(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('coerces truthy and falsy input', () => {
    setAmbientAlert(3);
    expect(getAmbientAlert()).toBe(true);
    setAmbientAlert(0);
    expect(getAmbientAlert()).toBe(false);
  });
});
