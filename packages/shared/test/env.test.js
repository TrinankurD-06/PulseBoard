import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { demoEnvFields, parseEnv } from '../src/env.js';

describe('parseEnv', () => {
  const schema = z.object({ PORT: z.coerce.number(), NAME: z.string().min(1) });

  it('returns parsed, coerced values', () => {
    expect(parseEnv(schema, { PORT: '4000', NAME: 'api' })).toEqual({ PORT: 4000, NAME: 'api' });
  });

  it('throws a readable error listing every problem', () => {
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(/PORT[\s\S]*NAME/);
  });
});

describe('demoEnvFields', () => {
  const schema = z.object(demoEnvFields);

  it('defaults to editable: read-only off, no owner account named', () => {
    expect(schema.parse({})).toEqual({ DEMO_READ_ONLY: false, DEMO_OWNER_EMAIL: undefined });
  });

  it('parses the boolean and normalizes the owner email', () => {
    expect(
      schema.parse({ DEMO_READ_ONLY: 'true', DEMO_OWNER_EMAIL: ' Boss@Example.com\n' }),
    ).toEqual({
      DEMO_READ_ONLY: true,
      DEMO_OWNER_EMAIL: 'boss@example.com',
    });
  });

  it('treats an empty owner email as not set and rejects junk', () => {
    expect(schema.parse({ DEMO_OWNER_EMAIL: '' }).DEMO_OWNER_EMAIL).toBeUndefined();
    expect(() => schema.parse({ DEMO_READ_ONLY: 'yes' })).toThrow();
    expect(() => schema.parse({ DEMO_OWNER_EMAIL: 'not-an-email' })).toThrow();
  });
});
