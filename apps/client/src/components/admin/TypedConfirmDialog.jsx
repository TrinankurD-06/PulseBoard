import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../../api/http.js';
import { typedConfirmMatches } from '../../lib/adminConsole.js';
import Button from '../ui/Button.jsx';
import { inputClasses } from '../ui/Field.jsx';
import Modal from '../ui/Modal.jsx';

function Body({
  cancelRef,
  consequences,
  requiredText,
  inputLabel,
  confirmLabel,
  extraReady,
  onCancel,
  onConfirm,
  children,
}) {
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const inputId = useId();
  const hintId = useId();
  const ready = typedConfirmMatches(typed, requiredText) && extraReady && !pending;

  async function onSubmit(event) {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      // The dialog stays open so the reason (for example ADMIN_PROTECTED) can be read.
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="space-y-3 text-sm text-muted">{consequences}</div>
      {children && <div className="mt-5">{children}</div>}
      <div className="mt-5">
        <label htmlFor={inputId} className="block text-xs text-faint">
          {inputLabel}
        </label>
        <p id={hintId} className="mt-1 text-xs text-faint">
          Type{' '}
          <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono break-all text-fg select-all">
            {requiredText}
          </code>{' '}
          exactly, including capital letters.
        </p>
        <input
          id={inputId}
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-describedby={hintId}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={inputClasses}
        />
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-status-down">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" disabled={!ready} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The confirmation for anything that cannot be undone: a native <dialog> (the app's Modal)
 * that says what will happen, and keeps the destructive button disabled until the admin
 * types `requiredText` exactly (case-sensitive). Cancel has focus first, so Enter never
 * confirms by accident; Esc and a click outside cancel.
 *
 * `consequences` is the text of what will happen, `children` extra options (placed above
 * the input), `extraReady` false keeps the button disabled while those options are
 * incomplete. `onConfirm` may throw: its message is shown inside the dialog.
 */
export default function TypedConfirmDialog({
  open,
  title,
  consequences,
  requiredText,
  inputLabel = 'Confirmation',
  confirmLabel = 'Delete',
  extraReady = true,
  onCancel,
  onConfirm,
  children,
}) {
  const cancelRef = useRef(null);
  // Runs after the Modal's own effect has opened the <dialog>, so this focus wins.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <Body
        cancelRef={cancelRef}
        consequences={consequences}
        requiredText={requiredText}
        inputLabel={inputLabel}
        confirmLabel={confirmLabel}
        extraReady={extraReady}
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        {children}
      </Body>
    </Modal>
  );
}
