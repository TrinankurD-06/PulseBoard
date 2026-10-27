import PublicHeader from '../components/public/PublicHeader.jsx';
import RingDotCta from '../components/ui/RingDotCta.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function NotFound({ message = "The page you're looking for doesn't exist." }) {
  useDocumentTitle('Not found');
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader cta={false} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 pb-24 sm:px-8">
        <p className="text-[11px] text-faint">Error 404</p>
        <h1
          className="animate-rise mt-3 font-light tracking-[-0.03em] text-fg"
          style={{ fontSize: 'clamp(44px, 7vw, 96px)', lineHeight: 1.02 }}
        >
          Not found.
        </h1>
        <p className="mt-5 max-w-[38ch] text-[15px] text-muted">{message}</p>
        <div className="mt-10">
          <RingDotCta to="/app">Go to your dashboard</RingDotCta>
        </div>
      </main>
    </div>
  );
}
