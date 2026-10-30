import { describe, expect, it } from 'vitest';
import { describeApiError } from './apiErrors.js';

describe('describeApiError', () => {
  it('keeps a suspension message that already says so, and adds the subject when it does not', () => {
    expect(describeApiError('WORKSPACE_SUSPENDED', 'Workspace suspended: abuse')).toBe(
      'Workspace suspended: abuse',
    );
    expect(describeApiError('WORKSPACE_SUSPENDED', 'abuse report')).toBe(
      'This workspace is suspended: abuse report',
    );
    expect(describeApiError('WORKSPACE_SUSPENDED')).toBe('This workspace is suspended.');
    expect(describeApiError('ACCOUNT_SUSPENDED', 'spam')).toBe('This account is suspended: spam');
  });

  it('explains a monitor an administrator stopped', () => {
    expect(describeApiError('STOPPED_BY_ADMIN', undefined)).toMatch(/only an administrator/i);
    expect(describeApiError('STOPPED_BY_ADMIN', 'Stopped by an administrator.')).toBe(
      'Stopped by an administrator.',
    );
  });

  it('passes every other message through', () => {
    expect(describeApiError('VALIDATION', 'Bad name')).toBe('Bad name');
    expect(describeApiError(undefined, undefined)).toBeUndefined();
    expect(describeApiError('ADMIN_PROTECTED', '')).toMatch(/protected/);
  });
});
