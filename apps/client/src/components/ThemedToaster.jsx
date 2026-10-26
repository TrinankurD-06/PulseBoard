import { Toaster } from 'sonner';
import { useTheme } from '../theme/ThemeContext.js';

export default function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="top-right" richColors closeButton />;
}
