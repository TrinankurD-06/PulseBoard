import { Check, ChevronsUpDown, Plus } from 'lucide-react';
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {workspace?.name ?? 'Select workspace'}
          </span>
          {workspace && (
            <span className="block text-xs text-slate-500 capitalize">{workspace.role}</span>
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute inset-x-0 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {workspaces.map((item) => (
              <li key={item.id} role="option" aria-selected={item.id === workspace?.id}>
                <Link
                  to={`/app/${item.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="truncate">{item.name}</span>
                  {item.id === workspace?.id && <Check className="h-4 w-4 text-emerald-500" />}
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
            className="flex w-full items-center gap-2 border-t border-slate-200 px-3 py-2 text-sm text-emerald-700 hover:bg-slate-100 dark:border-slate-800 dark:text-emerald-400 dark:hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" /> New workspace
          </button>
        </div>
      )}

      <CreateWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
