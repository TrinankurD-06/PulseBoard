// Which layout an error page (404, "not a member", a missing status page...) gets.
// Exactly one of these, never two stacked:
//   content: already inside the app shell, so just the message
//   wait:    the session is still being restored, so show a spinner, not a flash of
//            the wrong header
//   app:     logged in, so the app shell (header line and nav) around the message
//   public:  not logged in, so the public header around the message

const WORKSPACE_IN_PATH = /^\/app\/([a-f0-9]{24})(?:\/|$)/i;

/** The workspace named in an /app/:wid/... path, if the user belongs to it. */
export function workspaceFromPath(pathname, workspaceIds) {
  const id = WORKSPACE_IN_PATH.exec(pathname ?? '')?.[1];
  return id && workspaceIds.includes(id) ? id : null;
}

export function errorLayout({
  inShell,
  authStatus,
  isLoadingProfile = false,
  workspaceIds = [],
  pathname = '',
}) {
  if (inShell) return { kind: 'content' };
  if (authStatus === 'idle' || authStatus === 'loading' || isLoadingProfile) {
    return { kind: 'wait' };
  }
  if (authStatus === 'authenticated' && workspaceIds.length > 0) {
    // Keep the workspace the URL points at, so the nav stays where the user was.
    return { kind: 'app', wid: workspaceFromPath(pathname, workspaceIds) ?? workspaceIds[0] };
  }
  // Logged out, or logged in with no workspace to show a shell for.
  return { kind: 'public' };
}
