import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createConfirmController } from '../../lib/confirm.js';
import Button from './Button.jsx';
import { ConfirmContext } from './confirmContext.js';
import Modal from './Modal.jsx';

/**
 * Mounts the one confirm dialog for the app. Cancel is focused first (the native
 * dialog would otherwise focus its close button), so Enter never confirms a
 * destructive action by accident; Esc and a click outside cancel.
 */
export default function ConfirmProvider({ children }) {
  const controller = useMemo(() => createConfirmController(), []);
  const options = useSyncExternalStore(controller.subscribe, controller.getState);
  const cancelRef = useRef(null);
  // Runs after the Modal's own effect has opened the <dialog>, so this focus wins.
  useEffect(() => {
    if (options) cancelRef.current?.focus();
  }, [options]);
  const {
    title = 'Are you sure?',
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    tone = 'danger',
  } = options ?? {};

  return (
    <ConfirmContext.Provider value={controller.ask}>
      {children}
      <Modal open={Boolean(options)} onClose={() => controller.answer(false)} title={title}>
        {message && <p className="text-sm text-muted">{message}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button ref={cancelRef} variant="secondary" onClick={() => controller.answer(false)}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={() => controller.answer(true)}>
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
