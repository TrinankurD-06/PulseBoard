// A tiny publish/subscribe channel for live monitor events, so visual layers
// (the signal field) can react to them without owning the socket. useRealtime
// publishes every check:result and incident event here, after its own handling.
const listeners = new Set();

/** Publishes { type, payload }; a throwing listener never affects the others. */
export function publishCheckEvent(type, payload) {
  for (const listener of [...listeners]) {
    try {
      listener({ type, payload });
    } catch {
      // A visual subscriber must never break the realtime layer.
    }
  }
}

/** Subscribes to every event; returns the unsubscribe function. */
export function subscribeCheckEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to check:result payloads only. */
export function onCheckResult(listener) {
  return subscribeCheckEvents(({ type, payload }) => {
    if (type === 'check:result') listener(payload);
  });
}
