import { createContext, useContext } from 'react';

export const ConfirmContext = createContext(null);

/**
 * Returns `confirm(options) => Promise<boolean>`, which opens the styled
 * confirm dialog (see ConfirmProvider) instead of window.confirm:
 *
 *   if (!(await confirm({ title: 'Delete monitor', message: '…', confirmLabel: 'Delete' }))) return;
 */
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}
