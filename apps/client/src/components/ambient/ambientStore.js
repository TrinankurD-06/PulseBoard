import { useEffect, useSyncExternalStore } from 'react';

// Whether the ambient glow should warm toward the "down" colour. A page that
// knows a monitor is down raises it; the backdrop (mounted once in main.jsx)
// reads it. Tiny module-level store: no provider, and pages that don't care
// never touch it.
let alert = false;
const listeners = new Set();

export function setAmbientAlert(value) {
  const next = Boolean(value);
  if (next === alert) return;
  alert = next;
  for (const listener of listeners) listener();
}

export function getAmbientAlert() {
  return alert;
}

export function subscribeAmbientAlert(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The backdrop's view of the alert state. */
export function useAmbientAlert() {
  return useSyncExternalStore(subscribeAmbientAlert, getAmbientAlert, () => false);
}

/** For a page: warm the glow while `isDown` is true, and settle when it unmounts. */
export function useAmbientAlertSignal(isDown) {
  useEffect(() => {
    setAmbientAlert(isDown);
    return () => setAmbientAlert(false);
  }, [isDown]);
}
