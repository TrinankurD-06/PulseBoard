import { Toaster } from 'sonner';
import { useTheme } from '../theme/ThemeContext.js';

// Plain toasts use the app's warm surfaces; success/error keep sonner's rich
// green/red (state colours, not brand).
const SURFACES = {
  light: {
    '--normal-bg': 'var(--color-white)',
    '--normal-border': 'var(--color-slate-200)',
    '--normal-text': 'var(--color-slate-900)',
  },
  dark: {
    '--normal-bg': 'var(--color-slate-900)',
    '--normal-border': 'var(--color-slate-800)',
    '--normal-text': 'var(--color-slate-100)',
  },
};

export default function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster theme={theme} position="top-right" richColors closeButton style={SURFACES[theme]} />
  );
}
