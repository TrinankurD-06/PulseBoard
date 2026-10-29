/**
 * True when the server runs the public demo read-only and the logged-in user is
 * the demo account. Tolerates missing meta or user (still loading, logged out).
 */
export function isDemoReadOnly(meta, user) {
  if (!meta?.demoReadOnly || !meta.demoEmail) return false;
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  return email === String(meta.demoEmail).toLowerCase();
}
