import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../../api/http.js';
import Button from '../ui/Button.jsx';
import { inputClasses } from '../ui/Field.jsx';
import Modal from '../ui/Modal.jsx';

const MAX_LENGTH = 500;

function Body({
  cancelRef,
  description,
  label,
  hint,
  required,
  submitLabel,
  tone,
  onCancel,
  onSubmit,
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const id = useId();
  const trimmed = text.trim();
  const ready = (!required || trimmed.length > 0) && !pending;

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {description && <div className="space-y-2 text-sm text-muted">{description}</div>}
      <div className="mt-5">
        <label htmlFor={id} className="block text-xs text-faint">
          {label}
          {!required && ' (optional)'}
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_LENGTH}
          rows={3}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`${inputClasses} min-h-20 resize-y leading-relaxed`}
        />
        {hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-xs text-faint">
            {hint}
          </p>
        )}
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
        <Button type="submit" variant={tone} disabled={!ready} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Asks for a reason (suspending) or a note (pausing) before acting. A required reason keeps
 * the button disabled while empty. `onSubmit(text)` may throw: its message is shown inside
 * the dialog. Cancel has focus first; Esc cancels.
 */
export default function ReasonDialog({
  open,
  title,
  description,
  label = 'Reason',
  hint,
  required = true,
  submitLabel,
  tone = 'danger',
  onCancel,
  onSubmit,
}) {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <Body
        cancelRef={cancelRef}
        description={description}
        label={label}
        hint={hint}
        required={required}
        submitLabel={submitLabel}
        tone={tone}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
