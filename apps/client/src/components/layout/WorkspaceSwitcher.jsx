import { Check, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace.js';
import CreateWorkspaceModal from './CreateWorkspaceModal.jsx';

export default function WorkspaceSwitcher() {
  const { workspaces } = useAuth();
  const { workspace } = useCurrentWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef(null);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 rounded-pill border border-line py-1 pr-2.5 pl-3 text-[13px] text-muted transition-colors duration-200 hover:border-line-strong hover:text-fg"
      >
        <span className="max-w-[9rem] truncate sm:max-w-[16rem]">
          {workspace?.name ?? 'Select workspace'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
      </button>

      {open && (
        <div className="animate-modal-in absolute left-0 z-40 mt-2 w-64 overflow-hidden rounded-card border border-line-strong bg-bg/90 backdrop-blur-md">
          {workspace && (
            <p className="px-4 pt-3 text-[11px] text-faint capitalize">{workspace.role}</p>
          )}
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {workspaces.map((item) => (
              <li key={item.id} role="option" aria-selected={item.id === workspace?.id}>
                <Link
                  to={`/app/${item.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <span className="truncate">{item.name}</span>
                  {item.id === workspace?.id && <Check className="h-4 w-4 text-brand" />}
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Plus className="h-4 w-4" /> New workspace
          </button>
        </div>
      )}

      <CreateWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
