import { describe, expect, it, vi } from 'vitest';
import { createConfirmController } from './confirm.js';

describe('createConfirmController', () => {
  it('has no question until one is asked', () => {
    expect(createConfirmController().getState()).toBeNull();
  });

  it('resolves true when confirmed and false when cancelled, then clears the question', async () => {
    const controller = createConfirmController();
    const options = { title: 'Delete monitor', message: 'Sure?' };

    const yes = controller.ask(options);
    expect(controller.getState()).toBe(options);
    controller.answer(true);
    await expect(yes).resolves.toBe(true);
    expect(controller.getState()).toBeNull();

    const no = controller.ask(options);
    controller.answer(false);
    await expect(no).resolves.toBe(false);
  });

  it('notifies subscribers on every change, and stops after unsubscribe', () => {
    const controller = createConfirmController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.ask({ title: 'a' });
    controller.answer(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    controller.ask({ title: 'b' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a newer question cancels the older one', async () => {
    const controller = createConfirmController();
    const first = controller.ask({ title: 'first' });
    const second = controller.ask({ title: 'second' });
    await expect(first).resolves.toBe(false);
    expect(controller.getState()).toEqual({ title: 'second' });
    controller.answer(true);
    await expect(second).resolves.toBe(true);
  });

  it('ignores an answer when nothing is asked (a dialog reporting "closed" after it was answered)', async () => {
    const controller = createConfirmController();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.answer(false);
    expect(listener).not.toHaveBeenCalled();

    const result = controller.ask({ title: 'x' });
    controller.answer(true);
    controller.answer(false); // late "close" event: no effect
    await expect(result).resolves.toBe(true);
  });
});
