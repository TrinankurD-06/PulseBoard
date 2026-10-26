import { ROLE_RANK } from './constants.js';

/**
 * True if `role` grants at least the permissions of `minimumRole`.
 * Roles are strictly ordered: viewer < member < owner.
 * Browser-safe: the client uses it to hide actions, the API to enforce them.
 */
export function hasRole(role, minimumRole) {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[minimumRole];
}
