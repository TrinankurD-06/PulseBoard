import { describe, expect, it } from 'vitest';
import {
  addMemberSchema,
  loginSchema,
  objectIdSchema,
  paginationSchema,
  registerSchema,
  updateWorkspaceSchema,
} from '../src/schemas/index.js';

describe('auth schemas', () => {
  it('normalises email and enforces password length (8-72, bcrypt limit)', () => {
    const parsed = registerSchema.parse({
      name: ' Ada ',
      email: ' ADA@Example.COM ',
      password: 'password1',
    });
    expect(parsed).toEqual({ name: 'Ada', email: 'ada@example.com', password: 'password1' });
    expect(registerSchema.safeParse({ ...parsed, password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...parsed, password: 'x'.repeat(73) }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('workspace schemas', () => {
  it('validates names, member emails and roles', () => {
    expect(updateWorkspaceSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(addMemberSchema.parse({ email: 'X@Y.io', role: 'viewer' })).toEqual({
      email: 'x@y.io',
      role: 'viewer',
    });
    expect(addMemberSchema.safeParse({ email: 'x@y.io', role: 'admin' }).success).toBe(false);
  });
});

describe('common schemas', () => {
  it('pagination defaults and caps limit at 100', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationSchema.parse({ page: '3', limit: '100' })).toEqual({ page: 3, limit: 100 });
    expect(paginationSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('objectIdSchema accepts only 24 hex chars', () => {
    expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdSchema.safeParse('not-an-id').success).toBe(false);
  });
});
