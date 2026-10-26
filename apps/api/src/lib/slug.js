import { randomBytes } from 'node:crypto';

/** "My Team!" -> "my-team". Returns "" if nothing usable is left. */
export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Slug plus a short random suffix, so two "My Team" workspaces don't collide. */
export function uniqueSlug(text) {
  const base = slugify(text) || 'workspace';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
