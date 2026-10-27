import { describe, expect, it } from 'vitest';
import { errorLayout, workspaceFromPath } from './errorLayout.js';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

describe('workspaceFromPath', () => {
  it('reads a workspace the user belongs to out of an /app path', () => {
    expect(workspaceFromPath(`/app/${B}/nope`, [A, B])).toBe(B);
    expect(workspaceFromPath(`/app/${A}`, [A, B])).toBe(A);
    expect(workspaceFromPath(`/app/${A}/monitors/${B}`, [A, B])).toBe(A);
  });

  it('ignores a workspace the user is not in, and anything outside /app', () => {
    expect(workspaceFromPath(`/app/${'c'.repeat(24)}/x`, [A, B])).toBeNull();
    expect(workspaceFromPath(`/status/${A}`, [A, B])).toBeNull();
    expect(workspaceFromPath('/nope', [A])).toBeNull();
    expect(workspaceFromPath(undefined, [A])).toBeNull();
  });
});

describe('errorLayout: exactly one layout', () => {
  const loggedIn = { authStatus: 'authenticated', workspaceIds: [A, B], pathname: '/nope' };

  it('inside the app shell shows only the message, whoever is logged in', () => {
    expect(errorLayout({ ...loggedIn, inShell: true })).toEqual({ kind: 'content' });
    expect(errorLayout({ inShell: true, authStatus: 'anonymous' })).toEqual({ kind: 'content' });
  });

  it('shows the app shell for a logged-in user, never the public header', () => {
    expect(errorLayout({ ...loggedIn, inShell: false })).toEqual({ kind: 'app', wid: A });
  });

  it('keeps the workspace from the URL for the nav', () => {
    expect(errorLayout({ ...loggedIn, inShell: false, pathname: `/app/${B}/typo` })).toEqual({
      kind: 'app',
      wid: B,
    });
  });

  it('falls back to the first workspace when the URL names one the user is not in', () => {
    expect(
      errorLayout({ ...loggedIn, inShell: false, pathname: `/app/${'c'.repeat(24)}/x` }),
    ).toEqual({ kind: 'app', wid: A });
  });

  it('shows the public header for a logged-out visitor', () => {
    expect(errorLayout({ inShell: false, authStatus: 'anonymous', workspaceIds: [] })).toEqual({
      kind: 'public',
    });
  });

  it('waits while the session or the profile is still loading, so the wrong header never flashes', () => {
    for (const authStatus of ['idle', 'loading']) {
      expect(errorLayout({ inShell: false, authStatus })).toEqual({ kind: 'wait' });
    }
    expect(
      errorLayout({ inShell: false, authStatus: 'authenticated', isLoadingProfile: true }),
    ).toEqual({ kind: 'wait' });
  });

  it('uses the public header for a logged-in user with no workspace to show', () => {
    expect(errorLayout({ inShell: false, authStatus: 'authenticated', workspaceIds: [] })).toEqual({
      kind: 'public',
    });
  });

  it('only ever returns one of the four layouts', () => {
    const kinds = new Set();
    for (const inShell of [true, false]) {
      for (const authStatus of ['idle', 'loading', 'anonymous', 'authenticated']) {
        for (const workspaceIds of [[], [A]]) {
          for (const isLoadingProfile of [true, false]) {
            kinds.add(
              errorLayout({ inShell, authStatus, workspaceIds, isLoadingProfile, pathname: '/x' })
                .kind,
            );
          }
        }
      }
    }
    expect([...kinds].sort()).toEqual(['app', 'content', 'public', 'wait']);
  });
});
