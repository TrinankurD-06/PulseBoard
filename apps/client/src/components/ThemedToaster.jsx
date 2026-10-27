import { Toaster } from 'sonner';

// Plain toasts sit on the page with a hairline; success/error keep sonner's
// rich colours (state, not brand). Restyled as bottom-centre pills in phase 3.
const SURFACE = {
  '--normal-bg': 'var(--bg)',
  '--normal-border': 'var(--line-strong)',
  '--normal-text': 'var(--text)',
};

export default function ThemedToaster() {
  return <Toaster theme="dark" position="bottom-center" richColors closeButton style={SURFACE} />;
}
