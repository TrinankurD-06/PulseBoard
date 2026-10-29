import { lazy, Suspense, useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { errorLayout, workspaceFromPath } from '../lib/errorLayout.js';
import { AppShellContext } from './layout/appShellContext.js';
import Logo from './Logo.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import PublicHeader from './public/PublicHeader.jsx';
import FullPageSpinner from './ui/FullPageSpinner.jsx';
import RingDotCta from './ui/RingDotCta.jsx';

// The shell (navigation, workspace switcher, forms) is only needed when a logged-in
// user lands on an error page. Loaded on demand, it stays out of every other page's
// first download: this file is imported by App, so a static import would put it there.
const AppShell = lazy(() => import('./layout/AppShell.jsx'));

function ErrorContent({ code, title, message, action }) {
  const { label, ...ctaProps } = action;
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-1 py-16 sm:py-24">
      {code && <p className="text-[11px] text-faint">Error {code}</p>}
      <h1
        className="animate-rise mt-3 font-light tracking-[-0.03em] text-fg"
        style={{ fontSize: 'clamp(44px, 7vw, 96px)', lineHeight: 1.02 }}
      >
        {title}
      </h1>
      {message && <p className="mt-5 max-w-[38ch] text-[15px] text-muted">{message}</p>}
      <div className="mt-10">
        <RingDotCta {...ctaProps}>{label}</RingDotCta>
      </div>
    </section>
  );
}

function PublicFrame({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader cta={false} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 sm:px-8">{children}</main>
    </div>
  );
}

/** Picks the one layout this user should see (see lib/errorLayout.js). */
function ContextualError({ code, title, message, action }) {
  const inShell = useContext(AppShellContext);
  const { pathname } = useLocation();
  const { status, isLoadingProfile, workspaces, ensureSession } = useAuth();

  // Public routes never restore the session on their own; an error page has to,
  // or a logged-in user with a mistyped URL would be shown the logged-out header.
  useEffect(() => {
    if (!inShell) ensureSession();
  }, [inShell, ensureSession]);

  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const layout = errorLayout({
    inShell,
    authStatus: status,
    isLoadingProfile,
    workspaceIds,
    pathname,
  });
  // Inside the shell the user is logged in, so the way back is their dashboard too.
  const dashboardWid =
    layout.kind === 'app'
      ? layout.wid
      : layout.kind === 'content'
        ? (workspaceFromPath(pathname, workspaceIds) ?? workspaceIds[0])
        : null;

  const content = (
    <ErrorContent
      code={code}
      title={title}
      message={message}
      action={
        action ??
        (dashboardWid
          ? { label: 'Back to the dashboard', to: `/app/${dashboardWid}` }
          : { label: 'Go to PulseBoard', to: '/' })
      }
    />
  );

  switch (layout.kind) {
    case 'content':
      return content;
    case 'wait':
      return <FullPageSpinner />;
    case 'app':
      return (
        <Suspense fallback={<FullPageSpinner />}>
          <AppShell wid={layout.wid}>{content}</AppShell>
        </Suspense>
      );
    default:
      return <PublicFrame>{content}</PublicFrame>;
  }
}

/**
 * The wordmark and the message, nothing else. For the crash screen, which must
 * not depend on the session, the nav or anything else that could be what crashed.
 */
function PlainError({ code, title, message, action }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-5 sm:px-8">
        <Logo />
        <ThemeToggle className="ml-auto" />
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 sm:px-8">
        <ErrorContent code={code} title={title} message={message} action={action} />
      </main>
    </div>
  );
}

/**
 * Every error screen (404, workspace not found, missing status page, a crash)
 * goes through here. Exactly one layout is rendered: the app shell for a logged-in
 * user, the public header otherwise, and just the message when already inside
 * the app shell. `action` is { label, to | href | onClick }.
 */
export default function ErrorPage({ code, title, message, action, plain = false }) {
  useDocumentTitle(title.replace(/[.]$/, ''));
  const Page = plain ? PlainError : ContextualError;
  return <Page code={code} title={title} message={message} action={action} />;
}
