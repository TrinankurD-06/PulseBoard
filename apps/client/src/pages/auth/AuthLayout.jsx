import PublicHeader from '../../components/public/PublicHeader.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';

/** Centred, minimal: display headline and a muted phrase above the form. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  useDocumentTitle(title);
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden">
      {/* Extra soft moss light behind the form. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-[90px]"
        style={{ background: 'radial-gradient(circle, var(--glow), transparent 70%)' }}
      />
      <PublicHeader cta={false} />
      <main className="flex flex-1 items-center justify-center px-5 pb-20">
        <div className="animate-rise w-full max-w-sm">
          <h1
            className="text-center font-light tracking-[-0.03em] text-fg"
            style={{ fontSize: 'clamp(36px, 5vw, 56px)', lineHeight: 1.05 }}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-3 text-center text-sm text-muted">{subtitle}</p>}
          <div className="mt-10">{children}</div>
          {footer && <p className="mt-8 text-center text-sm text-muted">{footer}</p>}
        </div>
      </main>
      <p className="px-5 pb-6 text-center text-[11px] text-faint">PulseBoard</p>
    </div>
  );
}
