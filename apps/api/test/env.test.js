import { describe, expect, it } from 'vitest';
import { envSchema } from '../src/config/env.js';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/pulseboard',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('credentials pasted into a hosting dashboard', () => {
  it('ignores a stray newline or spaces around OAuth ids and secrets', () => {
    const env = envSchema.parse({
      ...base,
      GITHUB_CLIENT_ID: 'Ov23liExampleId12345\n',
      GITHUB_CLIENT_SECRET: '  secret-value \r\n',
      GOOGLE_CLIENT_ID: ' google-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-example\n',
    });
    expect(env.GITHUB_CLIENT_ID).toBe('Ov23liExampleId12345');
    expect(env.GITHUB_CLIENT_SECRET).toBe('secret-value');
    expect(env.GOOGLE_CLIENT_ID).toBe('google-id.apps.googleusercontent.com');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('GOCSPX-example');
  });

  it('treats a whitespace-only value as not configured', () => {
    const env = envSchema.parse({ ...base, GITHUB_CLIENT_ID: '\n', GITHUB_CLIENT_SECRET: ' ' });
    expect(env.GITHUB_CLIENT_ID).toBe('');
    expect(env.GITHUB_CLIENT_SECRET).toBe('');
  });

  it('trims the email provider settings too', () => {
    const env = envSchema.parse({
      ...base,
      RESEND_API_KEY: 're_abc\n',
      SMTP_HOST: ' smtp.example.com ',
    });
    expect(env.RESEND_API_KEY).toBe('re_abc');
    expect(env.SMTP_HOST).toBe('smtp.example.com');
  });
});

describe('demo account settings', () => {
  it('leaves the demo account editable by default', () => {
    const env = envSchema.parse(base);
    expect(env.DEMO_READ_ONLY).toBe(false);
    expect(env.DEMO_OWNER_EMAIL).toBeUndefined();
  });

  it('reads DEMO_READ_ONLY and DEMO_OWNER_EMAIL', () => {
    const env = envSchema.parse({
      ...base,
      DEMO_READ_ONLY: 'true',
      DEMO_OWNER_EMAIL: 'Owner@Example.com',
    });
    expect(env.DEMO_READ_ONLY).toBe(true);
    expect(env.DEMO_OWNER_EMAIL).toBe('owner@example.com');
  });
});
