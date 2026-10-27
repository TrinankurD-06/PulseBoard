import { Toaster } from 'sonner';

// Bottom-centre pills: hairline, blurred background, state shown by a
// coloured icon rather than a rich-colour fill.
const VARS = {
  '--normal-bg': 'color-mix(in oklab, var(--bg) 82%, transparent)',
  '--normal-border': 'var(--line-strong)',
  '--normal-text': 'var(--text)',
  '--border-radius': '999px',
};

const TOAST_CLASSES = {
  toast: '!backdrop-blur-md !px-5 !py-3 !text-[13px] !shadow-none',
  closeButton: '!border-line-strong !bg-bg !text-muted',
  success: '[&_[data-icon]]:!text-status-up',
  error: '[&_[data-icon]]:!text-status-down',
  warning: '[&_[data-icon]]:!text-status-degraded',
};

export default function ThemedToaster() {
  return (
    <Toaster
      theme="dark"
      position="bottom-center"
      closeButton
      style={VARS}
      toastOptions={{ classNames: TOAST_CLASSES }}
    />
  );
}
