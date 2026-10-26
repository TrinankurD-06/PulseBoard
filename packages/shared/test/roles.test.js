import { describe, expect, it } from 'vitest';
import { hasRole } from '../src/roles.js';

describe('hasRole', () => {
  it.each([
    ['owner', 'owner', true],
    ['owner', 'member', true],
    ['owner', 'viewer', true],
    ['member', 'owner', false],
    ['member', 'member', true],
    ['member', 'viewer', true],
    ['viewer', 'member', false],
    ['viewer', 'viewer', true],
  ])('%s satisfies %s: %s', (role, minimum, expected) => {
    expect(hasRole(role, minimum)).toBe(expected);
  });

  it('denies unknown or missing roles', () => {
    expect(hasRole(undefined, 'viewer')).toBe(false);
    expect(hasRole('admin', 'viewer')).toBe(false);
  });
});
