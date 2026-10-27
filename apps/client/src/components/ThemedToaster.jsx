import { Toaster } from 'sonner';
import { useTheme } from '../theme/ThemeContext.js';

// Plain toasts sit on the panel surface with a hairline; success/error keep
// sonner's rich colours (state, not brand).
const SURFACE = {
  '--normal-bg': 'var(--surface-2)',
  '--normal-border': 'var(--line-strong)',
  '--normal-text': 'var(--text)',
};

export default function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="top-right" richColors closeButton style={SURFACE} />;
}
