import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * Accessible modal built on the native <dialog> element, which gives focus
 * trapping, Esc-to-close and a backdrop for free. A centred outline card over
 * a blurred backdrop (styled in index.css).
 */
export default function Modal({ open, onClose, title, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => event.target === dialogRef.current && onClose()}
      className="modal m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line-strong bg-bg p-0 text-fg"
    >
      {open && (
        <div className="animate-modal-in p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="text-xl font-light tracking-[-0.02em]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-m-1 rounded-pill p-1 text-faint transition-colors hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
