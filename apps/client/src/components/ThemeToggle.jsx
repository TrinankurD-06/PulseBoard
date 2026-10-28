import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/ThemeContext.jsx';
import { cn } from '../lib/cn.js';

/** Round icon button that flips between the dark and light theme. */
export default function ThemeToggle({ className }) {
  const { theme, toggleTheme } = useTheme();
  const toLight = theme === 'dark';
  const Icon = toLight ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={toLight ? 'Switch to light theme' : 'Switch to dark theme'}
      title={toLight ? 'Light theme' : 'Dark theme'}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-line text-muted transition-colors duration-200 hover:border-line-strong hover:text-fg',
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
