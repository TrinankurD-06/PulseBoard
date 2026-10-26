// Whether the Socket.io connection is up. While it is, queries don't poll:
// changes arrive as events. If it drops (or websockets are blocked by a
// network), queries fall back to polling so the UI never goes stale.
let connected = false;
const listeners = new Set();

export const isRealtimeConnected = () => connected;

export function setRealtimeConnected(value) {
  connected = value;
  listeners.forEach((listener) => listener(value));
}

export function subscribeRealtime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For TanStack Query's refetchInterval: no polling while live, 30s otherwise. */
export const fallbackPollMs = () => (connected ? false : 30_000);
