import { Toaster } from 'sonner';

// Bottom-centre pills: hairline, blurred background, state shown by a
// coloured icon rather than a rich-colour fill.
const VARS = {
  // Lifted a little off the near-black page so the pill reads as a layer.
  '--normal-bg': 'color-mix(in oklab, var(--bg) 88%, var(--text) 12%)',
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
      // Long enough to read a sentence (the default is 4 s).
      duration={6000}
      // Above the mobile bottom nav bar, which would otherwise cover the toast.
      mobileOffset={{ bottom: 84 }}
      closeButton
      style={VARS}
      toastOptions={{ classNames: TOAST_CLASSES }}
    />
  );
}
