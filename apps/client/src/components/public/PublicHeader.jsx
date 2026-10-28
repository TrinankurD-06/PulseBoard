import { Link } from 'react-router-dom';
import Logo from '../Logo.jsx';
import ThemeToggle from '../ThemeToggle.jsx';
import RingDotCta from '../ui/RingDotCta.jsx';

/**
 * Shared chrome for the public and auth pages: wordmark, a hairline filling
 * the middle, small text links and the ring-dot call to action.
 */
export default function PublicHeader({ cta = true }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center gap-5 px-5 py-5 sm:px-8">
      <Logo />
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <nav aria-label="Main" className="flex items-center gap-5 text-[13px]">
        <Link
          to="/status/acme"
          className="hidden text-muted transition-colors duration-200 hover:text-fg sm:block"
        >
          Status page demo
        </Link>
        <Link to="/login" className="text-muted transition-colors duration-200 hover:text-fg">
          Log in
        </Link>
        {cta && (
          <RingDotCta to="/register" className="hidden text-[13px] sm:inline-flex">
            Get started
          </RingDotCta>
        )}
        <ThemeToggle />
      </nav>
    </header>
  );
}
