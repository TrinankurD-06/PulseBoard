/**
 * The state behind the styled confirm dialog: one question at a time, answered
 * with a promise. No React, so it can be tested on its own.
 *
 *   const answer = await controller.ask({ title, message, confirmLabel });   // true or false
 *
 * Asking again while a question is open cancels the older one (it resolves
 * false). `answer` is idempotent, so a dialog that reports "closed" after it
 * was answered cannot answer twice.
 */
export function createConfirmController() {
  let pending = null; // { options, resolve }
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The open question's options, or null. Same object until the question changes. */
    getState: () => pending?.options ?? null,
    ask(options) {
      pending?.resolve(false);
      return new Promise((resolve) => {
        pending = { options, resolve };
        emit();
      });
    },
    answer(value) {
      const current = pending;
      if (!current) return;
      pending = null;
      emit();
      current.resolve(Boolean(value));
    },
  };
}
