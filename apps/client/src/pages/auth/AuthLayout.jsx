import Logo from '../../components/Logo.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import Card from '../../components/ui/Card.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';

export default function AuthLayout({ title, subtitle, children, footer }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-center text-sm text-slate-500">{subtitle}</p>}
          <Card className="mt-8 p-6">{children}</Card>
          {footer && <p className="mt-6 text-center text-sm text-slate-500">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
