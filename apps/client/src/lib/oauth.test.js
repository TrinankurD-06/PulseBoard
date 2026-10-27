import { describe, expect, it } from 'vitest';
import { OAUTH_ERROR_MESSAGES, oauthErrorMessage, safeNextPath } from './oauth.js';

describe('safeNextPath', () => {
  it('keeps paths inside the app', () => {
    expect(safeNextPath('/app')).toBe('/app');
    expect(safeNextPath('/app/abc/monitors/123?tab=checks#top')).toBe(
      '/app/abc/monitors/123?tab=checks#top',
    );
  });

  it('falls back for absolute and protocol-relative URLs', () => {
    expect(safeNextPath('https://evil.example')).toBe('/app');
    expect(safeNextPath('//evil.example')).toBe('/app');
    expect(safeNextPath('/\\evil.example')).toBe('/app');
    expect(safeNextPath('javascript:alert(1)')).toBe('/app');
    expect(safeNextPath('app/relative')).toBe('/app');
  });

  it('falls back for control characters, empty and non-string values', () => {
    expect(safeNextPath('/\t/evil.example')).toBe('/app');
    expect(safeNextPath('/app\n')).toBe('/app');
    expect(safeNextPath('')).toBe('/app');
    expect(safeNextPath(null)).toBe('/app');
    expect(safeNextPath(undefined, '/login')).toBe('/login');
  });
});

describe('oauthErrorMessage', () => {
  it('has a message for every documented code and a generic fallback', () => {
    for (const code of [
      'OAUTH_DENIED',
      'OAUTH_STATE_INVALID',
      'OAUTH_EMAIL_UNVERIFIED',
      'OAUTH_PROVIDER_ERROR',
      'OAUTH_NOT_CONFIGURED',
      'RATE_LIMITED',
      'INTERNAL',
    ]) {
      expect(oauthErrorMessage(code)).toBe(OAUTH_ERROR_MESSAGES[code]);
    }
    expect(oauthErrorMessage('SOMETHING_ELSE')).toMatch(/didn't complete/);
    expect(oauthErrorMessage(null)).toMatch(/didn't complete/);
  });
});
