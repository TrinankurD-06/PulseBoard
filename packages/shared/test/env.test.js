import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEnv } from '../src/env.js';

describe('parseEnv', () => {
  const schema = z.object({ PORT: z.coerce.number(), NAME: z.string().min(1) });

  it('returns parsed, coerced values', () => {
    expect(parseEnv(schema, { PORT: '4000', NAME: 'api' })).toEqual({ PORT: 4000, NAME: 'api' });
  });

  it('throws a readable error listing every problem', () => {
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(/PORT[\s\S]*NAME/);
  });
});
